import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderGit, Search, Plus, FileText, ArrowRight, CheckCircle2, Shield, 
  UserCircle, MessageSquare, Send, Paperclip, Lock, Unlock, Users, ChevronRight, Stamp, Camera, Trash2
} from 'lucide-react';
import { 
  collection, query, where, onSnapshot, addDoc, updateDoc, doc, 
  serverTimestamp, orderBy, deleteField, DocumentData, getDocs, deleteDoc,
  getDoc, setDoc
} from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth } from './App';
import { motion, AnimatePresence } from 'motion/react';
import { AppUser, GedItem, Conversation } from './types';
import { jsPDF } from 'jspdf';
import DocumentScanner from './DocumentScanner';

// Helper to convert base64 data URI to standard Blob for secure sandbox preview
function dataURItoBlob(dataURI: string): Blob {
  try {
    const parts = dataURI.split(',');
    const byteString = atob(parts[1]);
    const mimeString = parts[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  } catch (e) {
    console.error("dataURItoBlob crash, returning generic fallback:", e);
    return new Blob([], { type: 'application/pdf' });
  }
}

const loadPdfJsGlobally = (): Promise<any> => {
  return new Promise((resolvePdf, rejectPdf) => {
    if ((window as any).pdfjsLib) {
      resolvePdf((window as any).pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      resolvePdf(pdfjsLib);
    };
    script.onerror = () => rejectPdf(new Error("Failed to load PDF.js script"));
    document.body.appendChild(script);
  });
};

export default function DossiersInternesPage() {
  const { user } = useAuth();

  // Core Helpers for Workflow Regulation and Role-Based Access Controls
  const isUserSealAuthorized = (u: any) => {
    if (!u) return false;
    const p = (u.poste || '').toLowerCase();
    const r = (u.role || '').toLowerCase();
    const perim = (u.perimetre || '').toLowerCase();
    return p.includes('chef de centre') || 
           p.includes('chef de bureau') || 
           p.includes('secrétariat') || 
           p.includes('secretariat') || 
           r === 'admin' || 
           perim === 'secretariat';
  };

  const isChefDeCentre = (u: any) => {
    if (!u) return false;
    const p = (u.poste || '').toLowerCase();
    return p.includes('chef de centre') || u.role === 'admin';
  };

  const isUserSecretariat = (u: any) => {
    if (!u) return false;
    const p = (u.poste || '').toLowerCase();
    const perim = (u.perimetre || '').toLowerCase();
    return p.includes('secrétariat') || p.includes('secretariat') || perim === 'secretariat' || u.role === 'admin';
  };

  const canResetLatestVersion = () => {
    if (!selectedDossier || !user) return false;
    const versions = selectedDossier.versions || [];
    if (versions.length <= 1) return false;
    const latestVer = versions[versions.length - 1];
    if (latestVer.createdBy !== user.uid) return false;
    
    // Check if the current perimetre is where the dossier is currently active
    const userPerim = user.perimetre || 'gestionnaire';
    return selectedDossier.activePerimetre === userPerim;
  };

  const handleResetLatestVersion = async () => {
    if (!selectedDossier || !user) return;
    if (!canResetLatestVersion()) {
      setStatusMsg("Action impossible : le dossier a déjà été transféré ou verrouillé par intégrité.");
      return;
    }
    
    try {
      const versions = [...(selectedDossier.versions || [])];
      const removedVer = versions.pop();
      const logs = [...(selectedDossier.historyLogs || [])];
      
      const latestLogIndex = logs.slice().reverse().findIndex(log => log.action === 'NOUVELLE_VERSION' && log.authorId === user.uid);
      if (latestLogIndex !== -1) {
        const realIndex = logs.length - 1 - latestLogIndex;
        logs.splice(realIndex, 1);
      }
      
      logs.push({
        id: Math.random().toString(36).slice(-6),
        authorId: user.uid,
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'RECOMMENCEMENT_VERSION',
        description: `L'agent a exercé son droit de recouvrement de travail : réinitialisation de la version V${removedVer?.version || ''} avant transfert.`,
        timestamp: new Date().toISOString()
      });

      await safeUpdateDossier(selectedDossier.id, {
        versions: versions,
        historyLogs: logs,
        isLocked: versions.length > 1,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
        text: `[Droit de Recommencer] : L'agent a réinitialisé et supprimé sa dernière version validée (calques & signatures)`,
        senderId: user.uid,
        senderName: user.displayName || 'Agent',
        senderRole: user.poste || 'Agent DGI',
        createdAt: serverTimestamp()
      });

      setStatusMsg("Calques réinitialisés ! Vous pouvez à nouveau apposer vos annotations, signature ou sceau.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`Erreur lors du recommencement : ${e.message}`);
    }
  };

  const handleInitiateCancellation = async () => {
    if (!selectedDossier || !user) return;
    setPendingAction({ type: 'status', value: 'Annulation en attente de confirmation' });
    setActionNoteText('');
    setActionNotePromptOpen(true);
  };

  const handleConfirmCancellation = async () => {
    if (!selectedDossier || !user) return;
    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorId: user.uid,
        authorName: user.displayName || 'Chef de Centre',
        authorRole: user.poste || 'Chef de Centre',
        action: 'CONFIRM_ANNULATION',
        description: `Annulation du dossier administrative confirmée et scellée de manière irréversible par le Chef de Centre.`,
        timestamp: new Date().toISOString()
      };
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      await safeUpdateDossier(selectedDossier.id, {
        status: 'Annulé',
        isLocked: true,
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
        text: `[ANNULATION DÉFINITIVE] : Annulation approuvée et scellée définitivement par le Chef de Centre. Le dossier est clos.`,
        senderId: user.uid,
        senderName: user.displayName || 'Chef',
        senderRole: user.poste || 'Chef de Centre',
        createdAt: serverTimestamp()
      });

      setStatusMsg("L'annulation définitive du dossier a été confirmée et enregistrée !");
    } catch (e: any) {
      console.error(e);
      setStatusMsg("Erreur lors de la confirmation d'annulation.");
    }
  };

  const handleRejectCancellation = async () => {
    if (!selectedDossier || !user) return;
    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorId: user.uid,
        authorName: user.displayName || 'Chef de Centre',
        authorRole: user.poste || 'Chef de Centre',
        action: 'REJET_ANNULATION',
        description: `Demande d'annulation rejetée par le Chef de Centre. Rétablissement du dossier à l'état [En cours].`,
        timestamp: new Date().toISOString()
      };
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      await safeUpdateDossier(selectedDossier.id, {
        status: 'En cours',
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
        text: `[DEMANDE D'ANNULATION REJETÉE] : Le Chef de Centre a rejeté l'annulation. Le dossier repasse En cours.`,
        senderId: user.uid,
        senderName: user.displayName || 'Chef',
        senderRole: user.poste || 'Chef de Centre',
        createdAt: serverTimestamp()
      });

      setStatusMsg("Demande d'annulation rejetée. Le dossier est rétabli.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg("Erreur lors du rejet d'annulation.");
    }
  };
  const [viewMode, setViewMode] = useState<'list' | 'dossier'>('list');
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [dossiers, setDossiers] = useState<GedItem[]>([]);
  const [selectedDossier, setSelectedDossier] = useState<GedItem | null>(null);
  const [selectedVersionNum, setSelectedVersionNum] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [staffUsers, setStaffUsers] = useState<AppUser[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('Tous');
  const [activeTab, setActiveTab] = useState<'details' | 'chat' | 'logs'>('details');

  // Full-screen document preview state
  const [isFullscreenPreviewOpen, setIsFullscreenPreviewOpen] = useState(false);

  // States to keep track of active optimized document views
  const [activeFileUrl, setActiveFileUrl] = useState<string>('');
  const [activeBlobUrl, setActiveBlobUrl] = useState<string>('');

  // Asynchronously compute/load fileUrl, supporting oversized split files (Règle 4)
  useEffect(() => {
    if (!selectedDossier) {
      setActiveFileUrl('');
      return;
    }

    let isSubscribed = true;

    const loadAsyncFile = async () => {
      let targetUrl = selectedDossier.fileUrl || '';

      // Fallback for oversized file
      if (!targetUrl || targetUrl === 'SPLIT_DATA') {
        try {
          const contentDoc = await getDoc(doc(db, 'ged_items_files', selectedDossier.id));
          if (contentDoc.exists() && isSubscribed) {
            targetUrl = contentDoc.data()?.fileUrl || '';
          }
        } catch (e) {
          console.error("Error loading split file content:", e);
        }
      }

      // Check if version selected
      if (selectedVersionNum) {
        const ver = selectedDossier.versions?.find(v => v.version === selectedVersionNum);
        if (ver) {
          if (ver.fileUrl && ver.fileUrl !== 'SPLIT_DATA') {
            targetUrl = ver.fileUrl;
          } else {
            // Check if version is stored in split files
            try {
              const verDoc = await getDoc(doc(db, 'ged_items_files', `${selectedDossier.id}_v${selectedVersionNum}`));
              if (verDoc.exists() && isSubscribed) {
                targetUrl = verDoc.data()?.fileUrl || targetUrl;
              }
            } catch (err) {
              console.error("Error loaded split version", err);
            }
          }
        }
      }

      if (isSubscribed) {
        setActiveFileUrl(targetUrl);
      }
    };

    loadAsyncFile();

    return () => {
      isSubscribed = false;
    };
  }, [selectedDossier?.id, selectedVersionNum, selectedDossier?.versions?.length, selectedDossier?.fileUrl]);

  // Clean-up and generate Blob URL for the active iframe PDF preview (removes browser restrictions)
  useEffect(() => {
    if (activeFileUrl && activeFileUrl.startsWith('data:application/pdf')) {
      try {
        const blob = dataURItoBlob(activeFileUrl);
        const url = URL.createObjectURL(blob);
        setActiveBlobUrl(url);
        return () => {
          URL.revokeObjectURL(url);
          setActiveBlobUrl('');
        };
      } catch (e) {
        console.error("Error preparing secure preview:", e);
        setActiveBlobUrl('');
      }
    } else {
      setActiveBlobUrl('');
    }
  }, [activeFileUrl]);

  // Safe wrapper for updating ged_items preventing 1MB Firestore size constraints
  const safeUpdateDossier = async (dossierId: string, payload: any) => {
    // Optimistic Local storage / state update fallback
    try {
      const cached = localStorage.getItem('cache_ged_items_administrative');
      if (cached) {
        let list = JSON.parse(cached) as GedItem[];
        
        // Clean up Firestore-specific sentinel values for clean JSON serialization
        const cleanPayloadForLocal = { ...payload };
        const keysToDelete: string[] = [];
        for (const key of Object.keys(cleanPayloadForLocal)) {
          const val = cleanPayloadForLocal[key];
          if (val && typeof val === 'object') {
            const isDeleteSentinel = 
              val.constructor?.name?.includes('FieldValue') || 
              (val._methodName && val._methodName.includes('delete')) || 
              (val.toString && val.toString().includes('FieldValue.delete')) ||
              (typeof val.isEqual === 'function' && typeof val._methodName === 'string' && val._methodName.includes('delete'));
            
            if (isDeleteSentinel) {
              keysToDelete.push(key);
              delete cleanPayloadForLocal[key];
            } else if (
              val.constructor?.name?.includes('FieldValue') || 
              (val._methodName && val._methodName.includes('serverTimestamp'))
            ) {
              cleanPayloadForLocal[key] = new Date().toISOString();
            }
          }
        }

        list = list.map(item => {
          if (item.id === dossierId) {
            const updatedItem = {
              ...item,
              ...cleanPayloadForLocal,
              updatedAt: new Date().toISOString()
            };
            keysToDelete.forEach(k => {
              delete (updatedItem as any)[k];
            });
            return updatedItem;
          }
          return item;
        });
        localStorage.setItem('cache_ged_items_administrative', JSON.stringify(list));
        setDossiers(list);
        setSelectedDossier(prev => {
          if (!prev || prev.id !== dossierId) return prev;
          const updatedPrev = { ...prev, ...cleanPayloadForLocal };
          keysToDelete.forEach(k => {
            delete (updatedPrev as any)[k];
          });
          return updatedPrev;
        });
      }
    } catch (e) {
      console.warn("Local storage optimistic update failed:", e);
    }

    try {
      // 1. If payload contains a massive fileUrl, split it
      if (payload.fileUrl && payload.fileUrl.length > 200000 && payload.fileUrl !== 'SPLIT_DATA') {
        try {
          await setDoc(doc(db, 'ged_items_files', dossierId), {
            fileUrl: payload.fileUrl,
            createdAt: serverTimestamp()
          });
          payload.fileUrl = 'SPLIT_DATA';
        } catch (e) {
          console.warn("Could not save to ged_items_files on Firestore:", e);
        }
      }

      // 2. If the raw selectedDossier is loaded and has a massive fileUrl but is not split yet, split it
      if (selectedDossier && selectedDossier.id === dossierId) {
        const currentUrl = selectedDossier.fileUrl;
        if (currentUrl && currentUrl.length > 200000 && currentUrl !== 'SPLIT_DATA') {
          try {
            await setDoc(doc(db, 'ged_items_files', dossierId), {
              fileUrl: currentUrl,
              createdAt: serverTimestamp()
            });
            payload.fileUrl = 'SPLIT_DATA';
          } catch (e) {
            console.error("Migration split error during update:", e);
          }
        }
      }

      // 3. Handle version files, signatures and stamps if they are in payload (bypass 1MB Firestore limit)
      if (payload.versions) {
        payload.versions = await Promise.all(payload.versions.map(async (ver: any) => {
          let updatedVer = { ...ver };

          // Split version file contents if oversized (>200KB)
          if (updatedVer.fileUrl && updatedVer.fileUrl.length > 200000 && updatedVer.fileUrl !== 'SPLIT_DATA') {
            try {
              try {
                await setDoc(doc(db, 'ged_items_files', `${dossierId}_v${updatedVer.version}`), {
                  fileUrl: updatedVer.fileUrl,
                  createdAt: serverTimestamp()
                });
              } catch (e) {
                console.warn("Firestore setDoc sub-file failed:", e);
              }
              updatedVer.fileUrl = 'SPLIT_DATA';
            } catch (e) {
              console.error("Version split error:", e);
              updatedVer.fileUrl = '';
            }
          }

          // Split signature image if base64/massive (>10KB) to bypass 1MB limit
          if (updatedVer.signatureUrl && updatedVer.signatureUrl.length > 10000 && updatedVer.signatureUrl !== 'SPLIT_DATA') {
            try {
              try {
                await setDoc(doc(db, 'ged_items_files', `${dossierId}_v${updatedVer.version}_sig`), {
                  fileUrl: updatedVer.signatureUrl,
                  createdAt: serverTimestamp()
                });
              } catch (e) {
                console.warn("Firestore setDoc signature failed:", e);
              }
              updatedVer.signatureUrl = 'SPLIT_DATA';
            } catch (e) {
              console.error("Version signature split error:", e);
              updatedVer.signatureUrl = '';
            }
          }

          // Split stamp image if base64/massive (>10KB) to bypass 1MB limit
          if (updatedVer.stampUrl && updatedVer.stampUrl.length > 10000 && updatedVer.stampUrl !== 'SPLIT_DATA') {
            try {
              try {
                await setDoc(doc(db, 'ged_items_files', `${dossierId}_v${updatedVer.version}_stamp`), {
                  fileUrl: updatedVer.stampUrl,
                  createdAt: serverTimestamp()
                });
              } catch (e) {
                console.warn("Firestore setDoc stamp failed:", e);
              }
              updatedVer.stampUrl = 'SPLIT_DATA';
            } catch (e) {
              console.error("Version stamp split error:", e);
              updatedVer.stampUrl = '';
            }
          }

          return updatedVer;
        }));
      }

      try {
        await updateDoc(doc(db, 'ged_items', dossierId), payload);
      } catch (err: any) {
        if (err?.message?.includes("Quota") || err?.code === "resource-exhausted") {
          console.warn("Firestore updateDoc quota exceeded, using local fallback only.");
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("safeUpdateDossier failed, but local state was preserved:", err);
    }
  };

  // New folder camera scanning & file import states
  const [importMethod, setImportMethod] = useState<'upload' | 'scanner' | null>(null);
  const [uploadedFileBase64, setUploadedFileBase64] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [uploadedFileExtension, setUploadedFileExtension] = useState<string>('pdf');
  const [uploadedFileSize, setUploadedFileSize] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannedImage, setScannedImage] = useState<string>('');

  // Sceau & Signature popup configurations
  const [uploadPopupType, setUploadPopupType] = useState<'signature' | 'stamp' | null>(null);
  const [showScannerForAsset, setShowScannerForAsset] = useState<'signature' | 'stamp' | null>(null);
  const [replyToMsg, setReplyToMsg] = useState<any | null>(null);
  const [showGedClassificationModal, setShowGedClassificationModal] = useState(false);
  const [destGedSpace, setDestGedSpace] = useState<'administrative' | 'private' | 'contributor'>('administrative');
  const [gedFileName, setGedFileName] = useState('');
  const [isClassifyingInGed, setIsClassifyingInGed] = useState(false);

  // Action notes & workflow variables (tracé collaboratif)
  const [actionNotePromptOpen, setActionNotePromptOpen] = useState(false);
  const [actionNoteText, setActionNoteText] = useState('');
  const [pendingAction, setPendingAction] = useState<{ type: 'status' | 'transfer', value: string, agentId?: string } | null>(null);
  const [selectedTargetAgentId, setSelectedTargetAgentId] = useState<string>('');
  const [taxpayerSearchQuery, setTaxpayerSearchQuery] = useState<string>('');

  // Defensive administrative purge hook removed to preserve real stored database files across sessions.

  // Transfer Read-Only evaluator
  const isTransferReadOnly = (() => {
    if (!selectedDossier || !user) return false;
    
    if (user.role === 'admin') {
      return false;
    }
    
    if (selectedDossier.status === 'En attente') {
      return true;
    }
    
    if (selectedDossier.activePerimetre && selectedDossier.activePerimetre !== user.perimetre) {
      return true;
    }
    
    if (selectedDossier.assignedAgentId && selectedDossier.assignedAgentId !== user.uid) {
      return true;
    }
    
    if (selectedDossier.secretariatWaiting === true && user.perimetre === 'secretariat') {
      return true;
    }
    
    return false;
  })();

  // Reset current overlays when in read-only mode
  useEffect(() => {
    if (isTransferReadOnly) {
      setIncludeSignature(false);
      setIncludeStamp(false);
      setAnnotationText('');
    }
  }, [isTransferReadOnly]);

  // Mark internal dossier as read when recipient is looking at it
  useEffect(() => {
    if (!selectedDossier || !user) return;
    
    const isRecipient = 
      selectedDossier.assignedAgentId === user.uid ||
      (selectedDossier.activePerimetre && selectedDossier.activePerimetre === user.perimetre && user.role !== 'contributor');
      
    if (isRecipient && !selectedDossier.openedByAgentAt) {
      const markAsRead = async () => {
        try {
          await updateDoc(doc(db, 'ged_items', selectedDossier.id), {
            openedByAgentAt: new Date().toISOString(),
            openedByAgentName: user.displayName || 'Agent'
          });
        } catch (e) {
          console.warn("Dossier write read-receipt failed:", e);
        }
      };
      markAsRead();
    }
  }, [selectedDossier?.id, user?.uid]);

  // Reset selected version when selection changes 
  useEffect(() => {
    setSelectedVersionNum(null);
    setLoadedOverlays({});
  }, [selectedDossier?.id]);

  const [loadedOverlays, setLoadedOverlays] = useState<Record<number, { signatureUrl?: string, stampUrl?: string }>>({});

  // Asynchronously load any split version overlays (signature / stamp)
  useEffect(() => {
    if (!selectedDossier || !selectedDossier.versions) return;
    
    let isSubscribed = true;

    const fetchAllOverlays = async () => {
      let updatedAny = false;
      const nextLoaded = { ...loadedOverlays };

      for (const ver of selectedDossier.versions) {
        const vNum = ver.version;
        const alreadyLoadedSig = nextLoaded[vNum]?.signatureUrl;
        const alreadyLoadedStamp = nextLoaded[vNum]?.stampUrl;

        let newSig = alreadyLoadedSig || (ver.signatureUrl !== 'SPLIT_DATA' ? ver.signatureUrl : undefined);
        let newStamp = alreadyLoadedStamp || (ver.stampUrl !== 'SPLIT_DATA' ? ver.stampUrl : undefined);

        if (ver.hasSignature && ver.signatureUrl === 'SPLIT_DATA' && !alreadyLoadedSig) {
          try {
            const sigDoc = await getDoc(doc(db, 'ged_items_files', `${selectedDossier.id}_v${vNum}_sig`));
            if (sigDoc.exists() && isSubscribed) {
              newSig = sigDoc.data()?.fileUrl || '';
              updatedAny = true;
            }
          } catch (err) {
            console.error("Error loading split signature:", err);
          }
        }

        if (ver.hasStamp && ver.stampUrl === 'SPLIT_DATA' && !alreadyLoadedStamp) {
          try {
            const stampDoc = await getDoc(doc(db, 'ged_items_files', `${selectedDossier.id}_v${vNum}_stamp`));
            if (stampDoc.exists() && isSubscribed) {
              newStamp = stampDoc.data()?.fileUrl || '';
              updatedAny = true;
            }
          } catch (err) {
            console.error("Error loading split stamp:", err);
          }
        }

        if (newSig !== alreadyLoadedSig || newStamp !== alreadyLoadedStamp) {
          nextLoaded[vNum] = {
            signatureUrl: newSig,
            stampUrl: newStamp
          };
          updatedAny = true;
        }
      }

      if (isSubscribed && updatedAny) {
        setLoadedOverlays(nextLoaded);
      }
    };

    fetchAllOverlays();

    return () => {
      isSubscribed = false;
    };
  }, [selectedDossier?.id, selectedDossier?.versions?.length]);

  // New Dossier inputs
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScannerComponent, setShowScannerComponent] = useState(false);
  const [newDossierName, setNewDossierName] = useState('');
  const [newDossierDesc, setNewDossierDesc] = useState('');

  // Annotation inputs
  const [annotationText, setAnnotationText] = useState('');
  const [annotationFontSize, setAnnotationFontSize] = useState<number>(12);
  const [annotationColor, setAnnotationColor] = useState<string>('#002f6c');
  const [includeSignature, setIncludeSignature] = useState(false);
  const [includeStamp, setIncludeStamp] = useState(false);

  // Multi-page PDF layout and control states
  const [pdfPagesCount, setPdfPagesCount] = useState<number>(1);
  const [activePdfPage, setActivePdfPage] = useState<number>(1);
  const [applyStampAllPages, setApplyStampAllPages] = useState<boolean>(false);
  const [applySigAllPages, setApplySigAllPages] = useState<boolean>(false);
  const [applyAnnotAllPages, setApplyAnnotAllPages] = useState<boolean>(false);

  // References and coordinates for drag and drop signature placement
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadedPdfDoc, setLoadedPdfDoc] = useState<any>(null);
  const [pdfRenderLoading, setPdfRenderLoading] = useState<boolean>(false);
  const [sigPosition, setSigPosition] = useState({ x: 65, y: 75 });
  const [sigSize, setSigSize] = useState({ width: 120, height: 60 });
  const [stampPosition, setStampPosition] = useState({ x: 25, y: 75 });
  const [stampSize, setStampSize] = useState({ width: 80, height: 80 });
  const [annotPosition, setAnnotPosition] = useState({ x: 45, y: 35 });
  const [annotSize, setAnnotSize] = useState({ width: 180, height: 75 });

  // General state resets when changing dossiers or version selections
  useEffect(() => {
    setActivePdfPage(1);
    setPdfPagesCount(1);
    setApplyStampAllPages(false);
    setApplySigAllPages(false);
    setApplyAnnotAllPages(false);
    setAnnotationColor('#002f6c');
  }, [selectedDossier?.id, selectedVersionNum]);

  // Parse and cache PDF document when active PDF changes
  useEffect(() => {
    if (!activeFileUrl) {
      setLoadedPdfDoc(null);
      setPdfPagesCount(1);
      setActivePdfPage(1);
      return;
    }
    
    const isPdf = activeFileUrl.startsWith('data:application/pdf') || 
                  (activeFileUrl.startsWith('blob:') && selectedDossier?.extension?.toLowerCase() === 'pdf') || 
                  activeFileUrl.endsWith('.pdf') ||
                  selectedDossier?.extension?.toLowerCase() === 'pdf';
                  
    if (!isPdf) {
      setLoadedPdfDoc(null);
      setPdfPagesCount(1);
      setActivePdfPage(1);
      return;
    }

    let active = true;
    const loadPdfDoc = async () => {
      try {
        setPdfRenderLoading(true);
        const pdfjsLib = await loadPdfJsGlobally();
        let pdfData: Uint8Array;
        
        const targetSource = activeFileUrl;
        
        if (targetSource.startsWith('data:')) {
          const base64Index = targetSource.indexOf(';base64,');
          const base64Str = targetSource.substring(base64Index + 8);
          const raw = window.atob(base64Str);
          const rawLength = raw.length;
          pdfData = new Uint8Array(new ArrayBuffer(rawLength));
          for (let i = 0; i < rawLength; i++) {
            pdfData[i] = raw.charCodeAt(i);
          }
        } else {
          let fetchUrl = targetSource;
          if (fetchUrl.startsWith('http://') || fetchUrl.startsWith('https://')) {
            fetchUrl = `/api/proxy-pdf?url=${encodeURIComponent(fetchUrl)}`;
          }
          const res = await fetch(fetchUrl);
          const blob = await res.blob();
          const arrayBuf = await blob.arrayBuffer();
          pdfData = new Uint8Array(arrayBuf);
        }
        
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdfDocument = await loadingTask.promise;
        
        if (active) {
          setLoadedPdfDoc(pdfDocument);
          setPdfPagesCount(pdfDocument.numPages);
          setActivePdfPage(1);
        }
      } catch (err) {
        console.error("Error parsing pdf document:", err);
      } finally {
        if (active) {
          setPdfRenderLoading(false);
        }
      }
    };
    
    loadPdfDoc();
    return () => {
      active = false;
    };
  }, [activeFileUrl, selectedDossier?.id]);

  // Render current PDF page on preview canvas
  useEffect(() => {
    if (!loadedPdfDoc || !previewCanvasRef.current) return;
    
    let active = true;
    const renderActivePage = async () => {
      try {
        const page = await loadedPdfDoc.getPage(activePdfPage);
        if (!active) return;
        
        const canvas = previewCanvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (err) {
        console.error("Error rendering page to preview canvas:", err);
      }
    };
    
    renderActivePage();
    return () => {
      active = false;
    };
  }, [loadedPdfDoc, activePdfPage]);

  // Native and multi-page compiler scanner states
  const [scannedFilesList, setScannedFilesList] = useState<{ id: string, name: string, base64: string }[]>([]);
  const [studioZoomMode, setStudioZoomMode] = useState<'normal' | 'studio'>('normal');
  const [singleFileExportFormat, setSingleFileExportFormat] = useState<'JPEG' | 'PDF'>('PDF');

  // Internal chat message input
  const [internalMsg, setInternalMsg] = useState('');
  const [chatMessages, setChatMessages] = useState<any[]>([]);

  // Linking taxpayer search
  const [taxpayerSearch, setTaxpayerSearch] = useState('');

  // Transfer Dropdown open
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  // Status message
  const [statusMsg, setStatusMsg] = useState('');

  // Local helper for logging and tracing snapshot/listener errors
  const handleLocalFirestoreError = (err: any, op: string, path: string) => {
    const errInfo = {
      error: err instanceof Error ? err.message : String(err),
      authInfo: {
        userId: user?.uid || 'Unknown',
        email: user?.email || 'Unknown'
      },
      operationType: op,
      path: path
    };
    console.error('[FIRESTORE_ERROR]', JSON.stringify(errInfo));
  };

  // Fetch staff agents
  useEffect(() => {
    if (!user) return;
    
    // Load local offline cached fallbacks immediately on initial mount
    try {
      const cached = localStorage.getItem('cache_users_staff_dossiers');
      if (cached) {
        setStaffUsers(JSON.parse(cached));
      }
    } catch (e) {
      console.warn("Error reading cached staff users:", e);
    }

    const q = query(collection(db, 'users'));
    const unsub = onSnapshot(q, (snap) => {
      const mapped = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as AppUser));
      setStaffUsers(mapped);
      try {
        localStorage.setItem('cache_users_staff_dossiers', JSON.stringify(mapped));
      } catch (e) {
        console.warn("Error caching staff users:", e);
      }
    }, (err) => {
      handleLocalFirestoreError(err, 'list', 'users_staff_dossiers');
      try {
        const cached = localStorage.getItem('cache_users_staff_dossiers');
        if (cached) {
          setStaffUsers(JSON.parse(cached));
        } else {
          // If no cache, set a mock list so the app doesn't crash or stay empty!
          const mockStaff = [
            { uid: 'mock_admin', displayName: 'Administrateur Principal', email: 'admin@dgi.gouv', role: 'admin', poste: 'Directeur Général des Impôts' },
            { uid: user.uid, displayName: user.displayName || 'Gradi Jackson Christ', email: user.email, role: 'admin', poste: 'Directeur Administration' }
          ];
          setStaffUsers(mockStaff);
        }
      } catch (e) {}
    });
    return () => unsub();
  }, [user]);

  // Fetch active taxpayer conversations
  useEffect(() => {
    if (!user) return;

    try {
      const cached = localStorage.getItem('cache_conversations_open_dossiers');
      if (cached) {
        setConversations(JSON.parse(cached));
      }
    } catch (e) {}

    const q = query(
      collection(db, 'conversations')
    );
    const unsub = onSnapshot(q, (snap) => {
      const mapped = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Conversation));
      setConversations(mapped);
      try {
        localStorage.setItem('cache_conversations_open_dossiers', JSON.stringify(mapped));
      } catch (e) {}
    }, (err) => {
      handleLocalFirestoreError(err, 'list', 'conversations_open_dossiers');
      try {
        const cached = localStorage.getItem('cache_conversations_open_dossiers');
        if (cached) {
          setConversations(JSON.parse(cached));
        } else {
          // Mock fallbacks for conversations under quota restrictions
          setConversations([
            { id: 'conv-001', studentName: 'Alphanet RDC', subject: 'Demande d\'exonération de la taxe sur la valeur ajoutée (TVA)', status: 'open', createdAt: new Date().toISOString() },
            { id: 'conv-002', studentName: 'Gradi Jackson Christ Sibi Nimi', subject: 'Preuve de paiement de l\'impôt sur le revenu professionnel', status: 'open', createdAt: new Date().toISOString() }
          ]);
        }
      } catch (e) {}
    });
    return () => unsub();
  }, [user]);

  // Fetch official administrative folders/files (dossiers)
  useEffect(() => {
    if (!user) return;

    // Explicitly delete any old seeded sample items so they do not taint the user's real file list
    deleteDoc(doc(db, 'ged_items', 'dossier-sample-01')).catch(() => {});
    deleteDoc(doc(db, 'ged_items', 'dossier-sample-02')).catch(() => {});

    try {
      const cached = localStorage.getItem('cache_ged_items_administrative');
      if (cached) {
        const list = (JSON.parse(cached) as GedItem[])
          .filter(d => d.id !== 'dossier-sample-01' && d.id !== 'dossier-sample-02');
        setDossiers(list);
      }
    } catch (e) {}

    const q = query(
      collection(db, 'ged_items'),
      where('space', '==', 'administrative'),
      where('type', '==', 'file'),
      where('isDeleted', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as GedItem))
        .filter(d => d.id !== 'dossier-sample-01' && d.id !== 'dossier-sample-02');
      
      setDossiers(list);
      try {
        localStorage.setItem('cache_ged_items_administrative', JSON.stringify(list));
      } catch (e) {}
      setSelectedDossier(prev => {
        if (!prev) return null;
        const updated = list.find(d => d.id === prev.id);
        return updated || prev;
      });
    }, (err) => {
      handleLocalFirestoreError(err, 'list', 'ged_items_administrative_dossiers');
      try {
        const cached = localStorage.getItem('cache_ged_items_administrative');
        if (cached) {
          const list = (JSON.parse(cached) as GedItem[])
            .filter(d => d.id !== 'dossier-sample-01' && d.id !== 'dossier-sample-02');
          setDossiers(list);
          setSelectedDossier(prev => {
            if (!prev) return null;
            const updated = list.find((d: any) => d.id === prev.id);
            return updated || prev;
          });
        } else {
          setDossiers([]);
        }
      } catch (e) {
        setDossiers([]);
      }
    });
    return () => unsub();
  }, [user]);

  // Fetch messages of selected dossier
  useEffect(() => {
    if (!selectedDossier) {
      setChatMessages([]);
      return;
    }
    const cacheKey = `cache_ged_items_${selectedDossier.id}_messages`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setChatMessages(JSON.parse(cached));
      }
    } catch (e) {}

    const q = query(
      collection(db, 'ged_items', selectedDossier.id, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const mapped = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setChatMessages(mapped);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(mapped));
      } catch (e) {}
    }, (err) => {
      handleLocalFirestoreError(err, 'list', `ged_items_${selectedDossier.id}_messages`);
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          setChatMessages(JSON.parse(cached));
        } else {
          // Friendly offline placeholder messages
          setChatMessages([
            {
              id: 'msg-promo-01',
              text: "Bienvenue dans l'espace collaboratif sécurisé de ce dossier.",
              senderId: 'system',
              senderName: 'Système DGI',
              createdAt: { seconds: Date.now() / 1000 - 3600 } as any
            }
          ]);
        }
      } catch (e) {}
    });
    return () => unsub();
  }, [selectedDossier?.id]);

  // Temporary Toast message
  useEffect(() => {
    if (statusMsg) {
      const timer = setTimeout(() => setStatusMsg(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [statusMsg]);

  // Auto-upgrade status to 'En cours' when opening/viewing a 'Nouveau' dossier
  useEffect(() => {
    if (!selectedDossier || !user) return;
    const currentStatus = selectedDossier.status || 'Nouveau';

    // 1. If Nouveau, let's auto-upgrade to 'En cours'
    if (currentStatus === 'Nouveau') {
      // Check if user is the dispatcher to avoid auto-upgrading their own sent files
      const isDispatcher = selectedDossier.lastDispatcherId === user.uid;
      if (!isDispatcher) {
        const runAutoUpgrade = async () => {
          try {
            const logEntry = {
              id: Math.random().toString(36).slice(-6),
              authorName: user.displayName || 'Agent',
              authorRole: user.poste || 'Agent DGI',
              action: 'CHANGEMENT_STATUT',
              description: `Dossier ouvert par le destinataire - passage automatique au statut 'En cours'.`,
              timestamp: new Date().toISOString()
            };
            const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];

            await safeUpdateDossier(selectedDossier.id, {
              status: 'En cours',
              historyLogs: updatedLogs,
              updatedAt: serverTimestamp()
            });

            // Print chat message trace (Règle 4)
            await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
              text: `[Consultation] Le dossier a été ouvert par ${user.displayName || 'un Agent'} - Statut passé automatiquement à En cours.`,
              senderId: 'system',
              senderName: 'Système DGI',
              senderRole: 'Routage automatique',
              createdAt: serverTimestamp()
            });

            setStatusMsg("Dossier pris en charge : statut 'En cours' activé !");
          } catch (err) {
            console.error("Auto status upgrade failed:", err);
          }
        };
        runAutoUpgrade();
      }
    }

    // 2. Record opening timestamp if user is the destinataire of a transferred dossier
    if (selectedDossier.lastDispatcherId && selectedDossier.lastDispatcherId !== user.uid && !selectedDossier.openedByRecipientAt) {
      const runRecordOpening = async () => {
        try {
          const nowISO = new Date().toISOString();
          await safeUpdateDossier(selectedDossier.id, {
            openedByRecipientAt: nowISO,
            openedByRecipientName: user.displayName || user.email || 'Agent'
          });
        } catch (err) {
          console.error("Failed to record dossier opening timestamp:", err);
        }
      };
      runRecordOpening();
    }
  }, [selectedDossier?.id, user]);

  // Camera stream scanners and file loaders
  const startCamera = async () => {
    try {
      setScannedImage('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setCameraStream(stream);
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 150);
    } catch (err) {
      console.error("Camera access failed, fallback active:", err);
      setStatusMsg("Accès caméra indisponible. Simulateur de scanner actif !");
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth || 640;
        canvas.height = videoRef.current.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0);
          
          // High contrast photocopier scan filter simulation
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const v = (0.2126 * r + 0.7152 * g + 0.0722 * b);
            const threshold = 135;
            const finalPixel = v > threshold ? 255 : 32;
            data[i] = finalPixel;
            data[i+1] = finalPixel;
            data[i+2] = finalPixel;
          }
          ctx.putImageData(imgData, 0, 0);
          
          const base64Url = canvas.toDataURL('image/jpeg', 0.5);
          setScannedImage(base64Url);
          setUploadedFileBase64(base64Url);
          setUploadedFileName(`Scan_Administrative_DGI_${Math.random().toString(36).slice(-4)}.jpeg`);
          setUploadedFileExtension('jpeg');
          setUploadedFileSize(14500);
          stopCamera();
        }
      } catch (err) {
        console.error("Capture capture processing error:", err);
        setStatusMsg("Erreur lors de la capture du scan.");
      }
    }
  };

  // Native multi-page compiler logic via jsPDF
  const compileImagesToPdf = async (images: string[]): Promise<string> => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'px',
      format: 'a4'
    });
    
    const a4W = pdf.internal.pageSize.getWidth();
    const a4H = pdf.internal.pageSize.getHeight();
    
    for (let i = 0; i < images.length; i++) {
      if (i > 0) {
        pdf.addPage();
      }
      
      const imgBase64 = images[i];
      // Draw image onto full page
      pdf.addImage(imgBase64, 'JPEG', 0, 0, a4W, a4H, `img_${i}`, 'FAST');
    }
    
    return pdf.output('datauristring');
  };

  const handleNativeScanFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newScannedList = [...scannedFilesList];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = (event) => {
          resolve(event.target?.result as string);
        };
      });
      reader.readAsDataURL(file);
      const base64 = await base64Promise;
      
      newScannedList.push({
        id: Math.random().toString(36).substring(3, 9),
        name: file.name,
        base64: base64
      });
    }

    setScannedFilesList(newScannedList);
    // satisfie condition creation
    if (newScannedList.length > 0) {
      setUploadedFileBase64(newScannedList[0].base64);
    }
    setStatusMsg(`${files.length} fichier(s) chargé(s) dans le scanner !`);
  };

  const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop() || 'pdf';
    setUploadedFileName(file.name);
    setUploadedFileExtension(ext);
    setUploadedFileSize(file.size);
    const reader = new FileReader();
    reader.onload = (event) => {
      setUploadedFileBase64(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Local sign/stamp extraction algorithm with pixel-luminance isolation (détourage) and compression
  const handleLocalImageDeterage = (file: File, type: 'signature' | 'stamp') => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxW = 350; // Increased resolution slightly for higher quality stamp details
          let w = img.width;
          let h = img.height;
          
          if (w > maxW) {
            h = Math.round((maxW / w) * h);
            w = maxW;
          }
          
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const imgData = ctx.getImageData(0, 0, w, h);
            const data = imgData.data;
            
            // Clean pixel background where luminance is high (isolates the pen ink or stamp color and removes white/gray background paper)
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i+1];
              const b = data[i+2];
              const a = data[i+3];
              if (a === 0) continue;
              
              const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
              if (luminance > 185) {
                data[i+3] = 0; // 100% transparent
              } else if (luminance > 140) {
                // Smooth edge transitions to prevent jaggy artifacts
                const alphaRatio = (185 - luminance) / (185 - 140);
                data[i+3] = Math.min(a, Math.round(alphaRatio * 255));
              }
            }
            ctx.putImageData(imgData, 0, 0);
            
            // Output as clean, lossless transparent PNG to perfectly preserve the alpha transparency
            const processedBase64Url = canvas.toDataURL('image/png');
            saveImageToProfile(type, processedBase64Url);
          }
        } catch (err) {
          console.error("Deterage image canvas error:", err);
          setStatusMsg("Traitement du détourage échoué.");
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const saveImageToProfile = async (type: 'signature' | 'stamp', base64Data: string) => {
    if (!user) return;
    try {
      const fieldName = type === 'signature' ? 'signatureUrl' : 'stampUrl';
      const label = type === 'signature' ? "de la signature" : "du sceau officiel";
      
      setStatusMsg(`Détourage ${label} et sauvegarde...`);
      await updateDoc(doc(db, 'users', user.uid), {
        [fieldName]: base64Data,
        updatedAt: serverTimestamp()
      });
      
      const agentsRef = collection(db, 'agents');
      const agentSnap = await getDocs(query(agentsRef, where('email', '==', user.email.toLowerCase().trim())));
      if (!agentSnap.empty) {
        await updateDoc(agentSnap.docs[0].ref, {
          [fieldName]: base64Data,
          updatedAt: serverTimestamp()
        });
      }
      
      if (type === 'signature') {
        setIncludeSignature(true);
      } else {
        setIncludeStamp(true);
      }
      setUploadPopupType(null);
      setStatusMsg(`${type === 'signature' ? 'Signature' : 'Sceau'} officiel détouré et enregistré avec succès !`);
    } catch (err) {
      console.error(err);
      setStatusMsg("Erreur lors de la sauvegarde profil.");
    }
  };

  // Helper to retrieve valid candidates to prevent vacant routing circuits
  const getCandidatesForPerimeter = (perim: string) => {
    let list = staffUsers.filter(u => u.perimetre === perim && u.isActive !== false);
    if (perim === 'superviseur') {
      list = staffUsers.filter(u => (u.perimetre === 'superviseur' || u.perimetre === 'superviseur_senior') && u.isActive !== false);
    }
    if (perim === 'gestionnaire') {
      list = staffUsers.filter(u => (u.perimetre === 'gestionnaire' || u.role === 'gestionnaire' || u.role === 'agent') && u.isActive !== false);
    }
    if (list.length === 0) {
      // Fallback: If no users assigned yet during staging, return system admins so selection never breaks
      const fallbackAdmins = staffUsers.filter(u => u.role === 'admin');
      if (fallbackAdmins.length > 0) {
        return fallbackAdmins.map(a => ({
          ...a,
          displayName: `${a.displayName || a.email} (Administrateur Référent)`
        }));
      }
      return [
        { uid: `default_${perim}_agent`, displayName: `Directeur par défaut [${perim === 'admin_bureau' ? 'Bureaux' : 'Superviseur'}]`, email: `direction.${perim}@dgi.gouv`, perimetre: perim } as any
      ];
    }
    return list;
  };

  // Note-enforcement interceptor methods (Tracé Collaboratif Règle 3 / 4)
  const triggerStatusUpdateWithNote = (newStatus: 'Nouveau' | 'En cours' | 'Terminé / Envoyé' | 'Archivé' | 'Annulé') => {
    const canArchive = user?.perimetre === 'secretariat' || user?.role === 'admin';
    if (newStatus === 'Archivé' && !canArchive) {
      setStatusMsg("Accès refusé : Seul le Secrétariat Général possède les droits d'archivage.");
      return;
    }
    setPendingAction({ type: 'status', value: newStatus });
    setActionNoteText('');
    setActionNotePromptOpen(true);
  };

  const triggerTransferWithNote = (targetPerimetre: string, targetAgentId?: string) => {
    setPendingAction({ type: 'transfer', value: targetPerimetre, agentId: targetAgentId });
    setActionNoteText('');
    setSelectedTargetAgentId('');
    setActionNotePromptOpen(true);
  };

  // Reset the transfer (Droit à l'erreur for Secrétariat and Chef de Gestionnaire)
  const handleCancelSecretariatTransfer = async () => {
    if (!selectedDossier || !user) return;
    try {
      const userPerimetre = user.perimetre || 'secretariat';
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorId: user.uid,
        authorName: user.displayName || 'Chef',
        authorRole: user.poste || 'Autorité de Contrôle',
        action: 'ANNULER_TRANSIT',
        description: `Dernier transfert annulé pour cause d'erreur de destinataire (Droit à l'erreur). Retour immédiat du dossier.`,
        timestamp: new Date().toISOString()
      };
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      await safeUpdateDossier(selectedDossier.id, {
        activePerimetre: userPerimetre,
        secretariatWaiting: false,
        waitingForReturnFrom: null,
        assignedAgentId: null,
        assignedAgentName: null,
        status: 'En cours',
        isLocked: false,
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      setStatusMsg("Le transfert a été annulé avec succès. Le dossier est retourné DIRECTEMENT au statut 'En cours' dans votre périmètre.");
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`Erreur lors de l'annulation du transfert: ${e.message || e}`);
    }
  };

  const handleClearCurrentPose = () => {
    setIncludeSignature(false);
    setIncludeStamp(false);
    setAnnotationText('');
    setSigPosition({ x: 65, y: 75 });
    setSigSize({ width: 120, height: 60 });
    setStampPosition({ x: 25, y: 75 });
    setStampSize({ width: 80, height: 80 });
    setAnnotPosition({ x: 45, y: 35 });
    setAnnotSize({ width: 180, height: 75 });
    setApplyStampAllPages(false);
    setApplySigAllPages(false);
    setApplyAnnotAllPages(false);
    setStatusMsg("Vos modifications en cours (sceau, signature et annotation) ont été effacées.");
  };

  const executePendingActionWithNote = async () => {
    if (!selectedDossier || !user || !actionNoteText.trim() || !pendingAction) {
      setStatusMsg("Veuillez renseigner le message textuel obligatoire.");
      return;
    }

    const noteMessage = actionNoteText.trim();
    setActionNotePromptOpen(false);

    try {
      if (pendingAction.type === 'status') {
        const newStatus = pendingAction.value as 'Nouveau' | 'En cours' | 'Terminé / Envoyé' | 'Archivé' | 'Annulé';
        const currentStatus = selectedDossier.status || 'Nouveau';

        // Reverting security check
        if ((currentStatus === 'Terminé / Envoyé' || currentStatus === 'Terminé') && newStatus === 'En cours') {
          const isAuthorized = user.role === 'admin' || 
                               (user.perimetre && ['admin_bureau', 'superviseur', 'superviseur_senior'].includes(user.perimetre));
          if (!isAuthorized) {
            setStatusMsg("Niveau refusé : Reclassement en cours interdit.");
            setPendingAction(null);
            return;
          }
        }

        const logEntry = {
          id: Math.random().toString(36).slice(-6),
          authorId: user.uid,
          authorName: user.displayName || 'Agent',
          authorRole: user.poste || 'Agent DGI',
          action: 'CHANGEMENT_STATUT',
          description: `Changement de statut vers [${newStatus}]. Note d'accompagnement : "${noteMessage}"`,
          timestamp: new Date().toISOString()
        };
        const rawProcessed = selectedDossier.processedByUids || [];
        const processedSet = new Set<string>([...rawProcessed, user.uid]);
        const nextProcessedByUids = Array.from(processedSet);
        const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];

        if (newStatus === 'Terminé / Envoyé' && selectedDossier.linkedConversationId) {
          const convId = selectedDossier.linkedConversationId;
          const convRef = doc(db, 'conversations', convId);
          const systemMsg = "Votre dossier a été traité avec succès par les services de la DGI.";
          await addDoc(collection(db, 'conversations', convId, 'messages'), {
            body: systemMsg,
            participants: [],
            senderId: 'system',
            senderName: 'Système DGI',
            receiverId: 'contributor',
            attachments: [],
            hasAttachments: false,
            createdAt: serverTimestamp(),
            conversationId: convId
          });

          await updateDoc(convRef, {
            isClosed: true,
            status: 'closed',
            closedAt: serverTimestamp(),
            closedBy: 'Système DGI (Routage Dossiers Automatique)',
            lastUpdate: serverTimestamp(),
            lastMessagePreview: systemMsg
          });

          updatedLogs.push({
            id: Math.random().toString(36).slice(-6),
            authorId: 'system',
            authorName: 'Système DGI',
            authorRole: 'Serveur de messagerie',
            action: 'NOTIF_CLOTURE_CONTRIBUABLE',
            description: `Messagerie contribuable clôturée en lecture seule après finalisation du dossier.`,
            timestamp: new Date().toISOString()
          });
        }

        await safeUpdateDossier(selectedDossier.id, {
          status: newStatus,
          historyLogs: updatedLogs,
          processedByUids: nextProcessedByUids,
          updatedAt: serverTimestamp()
        });

        const newMsgText = `[Note d'accompagnement - Changement de statut vers ${newStatus}] : / ${noteMessage}`;
        const optimistMsg = {
          id: "local_status_" + Math.random().toString(36).substring(3, 9),
          text: newMsgText,
          senderId: user.uid,
          senderName: user.displayName || 'Agent',
          senderRole: user.poste || 'Agent DGI',
          createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any
        };

        // Instant local display & cache update
        setChatMessages(prev => [...prev, optimistMsg]);
        try {
          const cacheMsgKey = `cache_ged_items_${selectedDossier.id}_messages`;
          const cached = localStorage.getItem(cacheMsgKey);
          const currentMsgs = cached ? JSON.parse(cached) : [];
          localStorage.setItem(cacheMsgKey, JSON.stringify([...currentMsgs, optimistMsg]));
        } catch (e) {
          console.warn(e);
        }

        // Add note as message to Chat messages sheet (Règle 3)
        try {
          await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
            text: newMsgText,
            senderId: user.uid,
            senderName: user.displayName || 'Agent',
            senderRole: user.poste || 'Agent DGI',
            createdAt: serverTimestamp()
          });
        } catch (e) {
          console.warn("Firestore addDoc log trace failed, kept in local state:", e);
        }

        setStatusMsg(`Dossier mis à jour vers le statut: ${newStatus}`);
      } else if (pendingAction.type === 'transfer') {
        const targetPerimetre = pendingAction.value;
        const targetAgentId = selectedTargetAgentId || pendingAction.agentId;
        const fromName = user.displayName || 'Agent';
        const pText = targetPerimetre === 'secretariat' ? 'Secrétariat Général' : 
                      targetPerimetre === 'gestionnaire' ? 'Service Gestionnaires DGI' : 
                      targetPerimetre === 'admin_bureau' ? 'Administration du Bureau' :
                      targetPerimetre === 'superviseur' ? 'Superviseurs' :
                      targetPerimetre === 'superviseur_senior' ? 'Superviseur Admin Senior' : 'Service Administratif';
                      
        const targetAgent = targetAgentId ? (staffUsers.find(u => u.uid === targetAgentId) || getCandidatesForPerimeter(targetPerimetre).find(u => u.uid === targetAgentId)) : null;
        const actDesc = `Dossier transféré au périmetre [${pText}]${targetAgent ? ` (${targetAgent.displayName})` : ''}. Note d'accompagnement obligatoire : "${noteMessage}"`;

        const logEntry = {
          id: Math.random().toString(36).slice(-6),
          authorId: user.uid,
          authorName: fromName,
          authorRole: user.poste || 'Chef de centre',
          action: 'TRANSIT_OUT',
          description: actDesc,
          timestamp: new Date().toISOString()
        };

        const rawProcessed = selectedDossier.processedByUids || [];
        const processedSet = new Set<string>([...rawProcessed, user.uid]);
        const nextProcessedByUids = Array.from(processedSet);
        const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
        
        // Return / Reactivation logic
        const targetAgentName = targetAgent ? (targetAgent.displayName || targetAgent.email) : null;
        const isRecipientPriorProcessor = targetAgentId && (
          rawProcessed.includes(targetAgentId) ||
          selectedDossier.versions?.some(v => v.createdBy === targetAgentId) ||
          selectedDossier.historyLogs?.some(log => log.authorId === targetAgentId)
        );
        const shouldReactivate = targetPerimetre === 'secretariat' || isRecipientPriorProcessor;

        // Sub-status En attente for secretariat
        const isFromSecretariat = isUserSecretariat(user);
        const secretariatWaiting = isFromSecretariat && targetPerimetre !== 'secretariat';
        const waitingForReturnFrom = secretariatWaiting 
          ? (targetAgentName ? `${targetAgentName} (${pText})` : pText)
          : (targetPerimetre === 'secretariat' ? null : (selectedDossier.waitingForReturnFrom || null));

        await safeUpdateDossier(selectedDossier.id, {
          isLocked: true, 
          status: shouldReactivate ? 'En cours' : 'Nouveau', 
          activePerimetre: targetPerimetre,
          lastDispatcherId: user.uid,
          assignedAgentId: targetAgentId || null,
          assignedAgentName: targetAgentName || null,
          openedByRecipientAt: null,
          openedByRecipientName: null,
          historyLogs: updatedLogs,
          processedByUids: nextProcessedByUids,
          secretariatWaiting: secretariatWaiting,
          waitingForReturnFrom: waitingForReturnFrom,
          updatedAt: serverTimestamp()
        });

        const transitMsgText = `[Note d'accompagnement - Transfert vers ${pText}] : / ${noteMessage}`;
        const optimistTransitMsg = {
          id: "local_transit_" + Math.random().toString(36).substring(3, 9),
          text: transitMsgText,
          senderId: user.uid,
          senderName: user.displayName || 'Agent',
          senderRole: user.poste || 'Agent DGI',
          createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any
        };

        // Instant local display & cache update
        setChatMessages(prev => [...prev, optimistTransitMsg]);
        try {
          const cacheMsgKey = `cache_ged_items_${selectedDossier.id}_messages`;
          const cached = localStorage.getItem(cacheMsgKey);
          const currentMsgs = cached ? JSON.parse(cached) : [];
          localStorage.setItem(cacheMsgKey, JSON.stringify([...currentMsgs, optimistTransitMsg]));
        } catch (e) {
          console.warn(e);
        }

        // Add note as message to Chat messages sheet (Règle 3)
        try {
          await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
            text: transitMsgText,
            senderId: user.uid,
            senderName: user.displayName || 'Agent',
            senderRole: user.poste || 'Agent DGI',
            createdAt: serverTimestamp()
          });
        } catch (e) {
          console.warn("Firestore addDoc transit trace failed, kept in local state:", e);
        }

        setIsTransferOpen(false);
        setStatusMsg(`Dossier transféré avec note d'accompagnement chez [${pText}] !`);
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("Erreur lors de l'exécution de l'action.");
    } finally {
      setPendingAction(null);
    }
  };

  // Create a new independent Administrative tracking dossier (with file/scanner methods)
  const handleCreateDossier = async () => {
    if (!newDossierName.trim() || !user) {
      setStatusMsg("Erreur : Veuillez saisir un titre pour le document.");
      return;
    }

    let finalFileBase64 = uploadedFileBase64;
    let finalFileName = uploadedFileName;
    let finalExtension = uploadedFileExtension;
    let finalSize = uploadedFileSize;

    if (importMethod === 'scanner') {
      if (scannedFilesList.length === 0) {
        setStatusMsg("Erreur : Aucun scan n'a été capturé. Veuillez prendre au moins une photo.");
        return;
      }
      setStatusMsg("Compilation des scans...");
      try {
        if (scannedFilesList.length === 1) {
          const file = scannedFilesList[0];
          const isPdfInput = file.base64.startsWith('data:application/pdf') || file.name.endsWith('.pdf');
          
          if (isPdfInput) {
            finalFileBase64 = file.base64;
            finalFileName = file.name;
            finalExtension = 'pdf';
            finalSize = Math.round((file.base64.length * 3) / 4);
          } else {
            if (singleFileExportFormat === 'JPEG') {
              finalFileBase64 = file.base64;
              finalFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpeg";
              finalExtension = 'jpeg';
              finalSize = Math.round((file.base64.length * 3) / 4);
            } else {
              const pdfDataUrl = await compileImagesToPdf([file.base64]);
              finalFileBase64 = pdfDataUrl;
              finalFileName = file.name.replace(/\.[^/.]+$/, "") + "_converti.pdf";
              finalExtension = 'pdf';
              finalSize = Math.round((pdfDataUrl.length * 3) / 4);
            }
          }
        } else {
          const imageBases = scannedFilesList.map(f => f.base64);
          const pdfDataUrl = await compileImagesToPdf(imageBases);
          finalFileBase64 = pdfDataUrl;
          finalFileName = `Compilation_MultiPages_Scan_${Math.random().toString(36).substring(3, 8).toUpperCase()}.pdf`;
          finalExtension = 'pdf';
          finalSize = Math.round((pdfDataUrl.length * 3) / 4);
        }
      } catch (err: any) {
        console.error(err);
        setStatusMsg("Erreurs de compilation : " + err.message);
        return;
      }
    }

    if (!finalFileBase64) {
      setStatusMsg("Erreur : Aucun document n'est rattaché. Veuillez le téléverser ou le scanner.");
      return;
    }

    try {
      const fileExceedsLimit = finalFileBase64 && finalFileBase64.length > 200000;

      const dossierRef = {
        name: newDossierName.trim(),
        type: 'file',
        parentId: null,
        space: 'administrative',
        ownerId: user.uid,
        ownerEmail: user.email,
        extension: finalExtension || 'png',
        fileUrl: fileExceedsLimit ? 'SPLIT_DATA' : finalFileBase64,
        fileSize: finalSize || 12480,
        isDeleted: false,
        status: 'Nouveau',
        processedByUids: [user.uid],
        createdBy: {
          uid: user.uid,
          displayName: user.displayName || 'Agent',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          matricule: (user as any).matricule || 'N/A'
        },
        createdAt: serverTimestamp(),
        historyLogs: [{
          id: Math.random().toString(36).slice(-6),
          authorId: user.uid,
          authorName: user.displayName || 'Agent',
          authorRole: user.poste || 'Secrétariat DGI',
          action: 'CREATION_DOSSIER',
          description: `Dossier administratif créé à l'étape Nouveau. Importation via méthode: ${importMethod || 'upload'}.`,
          timestamp: new Date().toISOString()
        }],
        versions: [{
          version: 1,
          fileUrl: '', // Keep empty string to avoid duplicating massive base64 payload to prevent firestore size limit errors
          annotation: newDossierDesc.trim() || 'Dossier administratif original créé.',
          createdBy: user.uid,
          createdByName: user.displayName,
          createdByRole: user.poste || 'Agent DGI',
          createdAt: new Date().toISOString()
        }]
      };

      let generatedId = "local_" + Math.random().toString(36).substring(3, 9);
      let docRefId = generatedId;

      try {
        const docRef = await addDoc(collection(db, 'ged_items'), dossierRef);
        docRefId = docRef.id;
        
        // Save sidecar document for massive file (1MB limit bypass)
        if (fileExceedsLimit) {
          try {
            await setDoc(doc(db, 'ged_items_files', docRefId), {
              fileUrl: finalFileBase64,
              createdAt: serverTimestamp()
            });
          } catch (e) {
            console.warn("Firestore setDoc sidecar file failed:", e);
          }
        }
        
        // Add chat message trace (Règle 3 / tracé collaboratif)
        try {
          await addDoc(collection(db, 'ged_items', docRefId, 'messages'), {
            text: `[DÉPÔT DOSSIER] Nouveau dossier administratif fiscal rattaché par ${user.displayName}. Note initiale : "${newDossierDesc.trim() || 'Aucune note initiale'}"`,
            senderId: user.uid,
            senderName: user.displayName || 'Agent',
            senderRole: user.poste || 'Secrétariat DGI',
            createdAt: serverTimestamp()
          });
        } catch (e) {
          console.warn("Firestore addDoc log message failed:", e);
        }
      } catch (err: any) {
        console.warn("Firestore addDoc for ged_items failed on quota limit, creating locally:", err);
      }

      // Optimistic Local cache fallback injection
      const finalDossierItem: GedItem = {
        id: docRefId,
        ...dossierRef,
        type: dossierRef.type as 'file' | 'folder',
        space: dossierRef.space as 'contributor' | 'private' | 'administrative',
        status: dossierRef.status as 'Nouveau' | 'En cours' | 'Terminé' | 'Terminé / Envoyé' | 'Archivé',
        fileUrl: finalFileBase64,
        createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any
      };

      try {
        const cached = localStorage.getItem('cache_ged_items_administrative');
        let currentList: GedItem[] = cached ? JSON.parse(cached) : [];
        currentList = [finalDossierItem, ...currentList];
        localStorage.setItem('cache_ged_items_administrative', JSON.stringify(currentList));
        setDossiers(currentList);
        setSelectedDossier(finalDossierItem);

        // Pre-warm local chat messages cache
        const cacheMsgKey = `cache_ged_items_${docRefId}_messages`;
        const initialMsgs = [{
          id: 'initial-msg-01',
          text: `[DÉPÔT DOSSIER] Nouveau dossier administratif fiscal rattaché par ${user.displayName}. Note initiale : "${newDossierDesc.trim() || 'Aucune note initiale'}"`,
          senderId: user.uid,
          senderName: user.displayName || 'Agent',
          senderRole: user.poste || 'Secrétariat DGI',
          createdAt: { seconds: Date.now() / 1000 } as any
        }];
        localStorage.setItem(cacheMsgKey, JSON.stringify(initialMsgs));
        if (selectedDossier?.id === docRefId) {
          setChatMessages(initialMsgs);
        }
      } catch (e) {
        console.warn("Failed to set dossier in localStorage:", e);
      }

      setNewDossierName('');
      setNewDossierDesc('');
      setUploadedFileBase64('');
      setUploadedFileName('');
      setScannedImage('');
      setScannedFilesList([]);
      setImportMethod(null);
      stopCamera();
      setShowCreateModal(false);
      setStatusMsg("Dossier créé avec succès ! En cours de traitement collaboratif.");
    } catch (e) {
      console.error(e);
      setStatusMsg("Une erreur s'est produite lors de la création.");
    }
  };

  // Formally attribute a gestionnaire (for Chefs exception direct transfer)
  const handleAssignDossier = async (agentId: string) => {
    if (!selectedDossier || !user) return;

    // Support clearing the assignment (Annuler un transfert / attribution - Droit à l'erreur)
    if (!agentId || agentId === '') {
      try {
        const logEntry = {
          id: Math.random().toString(36).slice(-6),
          authorId: user.uid,
          authorName: user.displayName || 'Agent Chef',
          authorRole: user.poste || 'Conseiller DGI',
          action: 'ANNULATION_ATTRIBUTION',
          description: `Attribution au gestionnaire annulée par la Direction (Droit à l'erreur). Le dossier retourne en attribution libre.`,
          timestamp: new Date().toISOString()
        };
        const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
        await safeUpdateDossier(selectedDossier.id, {
          assignedAgentId: null,
          assignedAgentName: null,
          status: 'En cours',
          isLocked: false,
          historyLogs: updatedLogs,
          updatedAt: serverTimestamp()
        });
        setStatusMsg("Attribution annulée avec succès (Droit à l'erreur).");
      } catch (e: any) {
        console.error(e);
        setStatusMsg("Erreur lors de l'annulation de l'attribution.");
      }
      return;
    }

    const targetAgent = staffUsers.find(a => a.uid === agentId);
    if (!targetAgent) return;

    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent Chef',
        authorRole: user.poste || 'Conseiller DGI',
        action: 'ATTRIBUTION_GESTIONNAIRE',
        description: `Dossier formellement attribué et commis au gestionnaire ${targetAgent.displayName || targetAgent.email}.`,
        timestamp: new Date().toISOString()
      };
      
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      await safeUpdateDossier(selectedDossier.id, {
        assignedAgentId: targetAgent.uid,
        assignedAgentName: targetAgent.displayName || targetAgent.email,
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      setStatusMsg(`Dossier attribué à ${targetAgent.displayName}`);
    } catch (e) {
      console.error(e);
      setStatusMsg("Erreur d'attribution.");
    }
  };

  // Secure Route Routing Transit Dispatcher
  const handleTransferDossier = async (targetPerimetre: string, targetAgentId?: string) => {
    if (!selectedDossier || !user) return;
    try {
      // Lorsqu'un dossier est dispatché, le fichier original/precedent est verrouillé
      const fromName = user.displayName || 'Agent';
      const pText = targetPerimetre === 'secretariat' ? 'Secrétariat Général' : 
                    targetPerimetre === 'gestionnaire' ? 'Gestionnaire' : 'Service Administratif';
                    
      const targetAgent = targetAgentId ? staffUsers.find(u => u.uid === targetAgentId) : null;
      const actDesc = `Dossier transféré au périmètre [${pText}]${targetAgent ? ` (${targetAgent.displayName})` : ''}. Le fichier original est verrouillé pour sécurisation d'étape.`;

      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorId: user.uid,
        authorName: fromName,
        authorRole: user.poste || 'Chef de centre',
        action: 'TRANSIT_OUT',
        description: actDesc,
        timestamp: new Date().toISOString()
      };

      const rawProcessed = selectedDossier.processedByUids || [];
      const processedSet = new Set<string>([...rawProcessed, user.uid]);
      const nextProcessedByUids = Array.from(processedSet);
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      
      // Return / Reactivation logic
      const targetAgentName = targetAgent ? (targetAgent.displayName || targetAgent.email) : null;
      const isRecipientPriorProcessor = targetAgentId && (
        rawProcessed.includes(targetAgentId) ||
        selectedDossier.versions?.some(v => v.createdBy === targetAgentId) ||
        selectedDossier.historyLogs?.some(log => log.authorId === targetAgentId)
      );
      const shouldReactivate = targetPerimetre === 'secretariat' || isRecipientPriorProcessor;

      // Sub-status En attente for secretariat
      const isFromSecretariat = isUserSecretariat(user);
      const secretariatWaiting = isFromSecretariat && targetPerimetre !== 'secretariat';
      const waitingForReturnFrom = secretariatWaiting 
        ? (targetAgentName ? `${targetAgentName} (${pText})` : pText)
        : (targetPerimetre === 'secretariat' ? null : (selectedDossier.waitingForReturnFrom || null));

      await safeUpdateDossier(selectedDossier.id, {
        isLocked: true, // Lock document when dispatched/routed
        status: shouldReactivate ? 'En cours' : 'Nouveau',
        activePerimetre: targetPerimetre,
        lastDispatcherId: user.uid,
        assignedAgentId: targetAgentId || selectedDossier.assignedAgentId || null,
        assignedAgentName: targetAgentName || selectedDossier.assignedAgentName || null,
        openedByRecipientAt: null,
        openedByRecipientName: null,
        historyLogs: updatedLogs,
        processedByUids: nextProcessedByUids,
        secretariatWaiting: secretariatWaiting,
        waitingForReturnFrom: waitingForReturnFrom,
        updatedAt: serverTimestamp()
      });

      setIsTransferOpen(false);
      setStatusMsg(`Dossier dispatché au périmètre ${pText}`);
    } catch (e) {
      console.error(e);
      setStatusMsg("Erreur lors du dispatching.");
    }
  };

  // --- lightweight visual drag / drop helpers ---
  const startDrag = (e: React.MouseEvent | React.TouchEvent, type: 'signature' | 'stamp' | 'annotation') => {
    e.preventDefault();
    const container = previewContainerRef.current;
    if (!container) return;

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const rect = container.getBoundingClientRect();
      const clientX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
      const clientY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : (moveEvent as MouseEvent).clientY;
      
      // Calculate relative percentage (0-100) inside container
      let x = ((clientX - rect.left) / rect.width) * 100;
      let y = ((clientY - rect.top) / rect.height) * 100;
      
      // Keep within bounds
      x = Math.max(0, Math.min(100, x));
      y = Math.max(0, Math.min(100, y));
      
      if (type === 'signature') {
        setSigPosition({ x, y });
      } else if (type === 'stamp') {
        setStampPosition({ x, y });
      } else {
        setAnnotPosition({ x, y });
      }
    };

    const handleEnd = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
  };

  const startResize = (e: React.MouseEvent | React.TouchEvent, type: 'signature' | 'stamp' | 'annotation') => {
    e.stopPropagation();
    e.preventDefault();
    
    const initialClientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const initialWidth = type === 'signature' ? sigSize.width : type === 'stamp' ? stampSize.width : annotSize.width;
    const initialHeight = type === 'signature' ? sigSize.height : type === 'stamp' ? stampSize.height : annotSize.height;

    const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentClientX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
      const deltaX = currentClientX - initialClientX;
      
      // Safe proportional resize mapping
      const factor = Math.max(0.4, Math.min(2.5, 1 + deltaX / initialWidth));
      
      if (type === 'signature') {
        setSigSize({
          width: Math.max(60, Math.min(300, initialWidth * factor)),
          height: Math.max(30, Math.min(150, initialHeight * factor))
        });
      } else if (type === 'stamp') {
        setStampSize({
          width: Math.max(50, Math.min(200, initialWidth * factor)),
          height: Math.max(50, Math.min(200, initialHeight * factor))
        });
      } else {
        setAnnotSize({
          width: Math.max(100, Math.min(350, initialWidth * factor)),
          height: Math.max(40, Math.min(200, initialHeight * factor))
        });
      }
    };

    const handleEnd = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleMove, { passive: true });
    window.addEventListener('touchend', handleEnd);
  };

  // Apply visual Annotations and Signatures / Stamps via absolute positions storage
  const handleAddAnnotationSignature = async () => {
    if (!selectedDossier || !user) return;
    if (!annotationText.trim() && !includeSignature && !includeStamp) {
      setStatusMsg("Veuillez saisir une annotation ou inclure un élément de validation.");
      return;
    }

    if (includeStamp && !isUserSealAuthorized(user)) {
      setStatusMsg("Habilitation insuffisante : Profil non autorisé à sceller le document avec le sceau de la DGI.");
      return;
    }

    setStatusMsg("Validation et scellage en cours...");

    try {
      const nextVer = (selectedDossier.versions?.length || 1) + 1;
      const baseImgUrl = selectedDossier.fileUrl || '';

      const newVerObj = {
        version: nextVer,
        fileUrl: '', // Keep empty string to avoid duplicating massive base64 payload in versions array; renders/downloads gracefully fallback to the original dossier's fileUrl
        annotation: annotationText.trim() || 'Avenant de validation signé.',
        annotFontSize: annotationFontSize,
        annotColor: annotationText.trim() ? annotationColor : null,
        hasSignature: includeSignature,
        hasStamp: includeStamp,
        signatureUrl: includeSignature ? (user.signatureUrl || '') : '',
        stampUrl: includeStamp ? (user.stampUrl || '') : '',
        sigPosition: includeSignature ? sigPosition : null,
        sigSize: includeSignature ? sigSize : null,
        sigPage: includeSignature ? (applySigAllPages ? 'all' : activePdfPage) : null,
        stampPosition: includeStamp ? stampPosition : null,
        stampSize: includeStamp ? stampSize : null,
        stampPage: includeStamp ? (applyStampAllPages ? 'all' : activePdfPage) : null,
        annotPosition: annotationText.trim() ? annotPosition : null,
        annotSize: annotationText.trim() ? annotSize : null,
        annotPage: annotationText.trim() ? (applyAnnotAllPages ? 'all' : activePdfPage) : null,
        createdBy: user.uid,
        createdByName: user.displayName || 'Agent',
        createdByRole: user.poste || 'Administrateur',
        createdAt: new Date().toISOString()
      };

      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorId: user.uid,
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'NOUVELLE_VERSION',
        description: `Génération de la Version V${nextVer} scellée sur document. ${includeSignature ? '[Signature manuscrite apposée]' : ''} ${includeStamp ? '[Sceau officiel d\'État scellé]' : ''}`,
        timestamp: new Date().toISOString()
      };

      const rawProcessed = selectedDossier.processedByUids || [];
      const processedSet = new Set<string>([...rawProcessed, user.uid]);
      const nextProcessedByUids = Array.from(processedSet);

      const updatedVersions = [...(selectedDossier.versions || []), newVerObj];
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];

      await safeUpdateDossier(selectedDossier.id, {
        versions: updatedVersions,
        historyLogs: updatedLogs,
        processedByUids: nextProcessedByUids,
        isLocked: true, 
        updatedAt: serverTimestamp()
      });

      // Add audit log in chat (Règle 3 / tracé collaboratif)
      await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
        text: `[Scellage Version V${nextVer}] : ${annotationText.trim() || "Visa de validation enregistré."} ${includeSignature ? '[Signature validée et intégrée]' : ''} ${includeStamp ? '[Sceau DGI officiel fusionné avec le document]' : ''}`,
        senderId: user.uid,
        senderName: user.displayName || 'Agent',
        senderRole: user.poste || 'Agent DGI',
        createdAt: serverTimestamp()
      });

      setAnnotationText('');
      setIncludeSignature(false);
      setIncludeStamp(false);
      setStatusMsg(`La version V${nextVer} a été scellée et enregistrée avec succès !`);
    } catch (e: any) {
      console.error(e);
      setStatusMsg(`Erreur critique de scellage : ${e.message || "Une erreur s'est produite"}`);
    }
  };

  // Action: Link taxpayer discussion
  const handleLinkDiscussion = async (convId: string) => {
    if (!selectedDossier || !user) return;
    try {
      const conv = conversations.find(c => c.id === convId);
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Secrétariat DGI',
        action: 'LIAISON_CONTRIBUABLE',
        description: `Dossier administratif lié à la discussion de ${conv?.contributorName || conv?.companyName || 'Contribuable'} (Sujet: ${conv?.subject}).`,
        timestamp: new Date().toISOString()
      };

      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      await safeUpdateDossier(selectedDossier.id, {
        linkedConversationId: convId,
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      setStatusMsg("Dossier lié avec succès au contribuable !");
    } catch (e) {
      console.error(e);
      setStatusMsg("Erreur de liaison.");
    }
  };

  // Action: Detach taxpayer discussion
  const handleUnlinkDiscussion = async () => {
    if (!selectedDossier || !user) return;
    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'DGI',
        action: 'DELIAISON_CONTRIBUABLE',
        description: `Dossier administratif détaché du contribuable.`,
        timestamp: new Date().toISOString()
      };

      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      await safeUpdateDossier(selectedDossier.id, {
        linkedConversationId: deleteField(),
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      setStatusMsg("Liaison détachée.");
    } catch (e) {
      console.error(e);
      setStatusMsg("Erreur de détachement.");
    }
  };

  // Save internal messages on this specific dossier
  const handleSendInternalDossierMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedDossier || !internalMsg.trim()) return;

    const textToSend = internalMsg.trim();
    const newMsgObj = {
      id: "local_msg_" + Math.random().toString(36).substring(3, 9),
      text: textToSend,
      senderId: user.uid,
      senderName: user.displayName || 'Agent',
      senderRole: user.poste || 'Agent DGI',
      createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
      replyTo: replyToMsg ? { id: replyToMsg.id, text: replyToMsg.text, senderName: replyToMsg.senderName } : null
    };

    // Optimistic UI updates
    setChatMessages(prev => [...prev, newMsgObj]);
    setInternalMsg('');
    const tempReplyTo = replyToMsg;
    setReplyToMsg(null);

    try {
      const cacheMsgKey = `cache_ged_items_${selectedDossier.id}_messages`;
      const cached = localStorage.getItem(cacheMsgKey);
      const currentMsgs = cached ? JSON.parse(cached) : [];
      localStorage.setItem(cacheMsgKey, JSON.stringify([...currentMsgs, newMsgObj]));
    } catch (e) {
      console.warn("Could not cache message locally:", e);
    }

    try {
      await addDoc(collection(db, 'ged_items', selectedDossier.id, 'messages'), {
        text: textToSend,
        senderId: user.uid,
        senderName: user.displayName || 'Agent',
        senderRole: user.poste || 'Agent DGI',
        createdAt: serverTimestamp(),
        replyTo: tempReplyTo ? { id: tempReplyTo.id, text: tempReplyTo.text, senderName: tempReplyTo.senderName } : null
      });
    } catch (e) {
      console.warn("Firestore addDoc for message failed (Quota limits etc.), message preserved in local state:", e);
    }
  };

  // Secure dynamic asynchronous download of dossier (original or specific version)
  const handleDownloadDossier = async (versionNum?: number) => {
    if (!selectedDossier) return;
    setStatusMsg("Récupération sécurisée du fichier pour le téléchargement...");
    try {
      let targetUrl = selectedDossier.fileUrl || '';

      if (versionNum) {
        const ver = selectedDossier.versions?.find(v => v.version === versionNum);
        if (ver) {
          targetUrl = ver.fileUrl || '';
          if (!targetUrl || targetUrl === 'SPLIT_DATA') {
            const verDoc = await getDoc(doc(db, 'ged_items_files', `${selectedDossier.id}_v${versionNum}`));
            if (verDoc.exists()) {
              targetUrl = verDoc.data()?.fileUrl || '';
            }
          }
        }
        // Fallback to original document file if the version does not have its own custom file data
        if (!targetUrl || targetUrl === 'SPLIT_DATA') {
          targetUrl = selectedDossier.fileUrl || '';
        }
      }

      // If still empty or marked as SPLIT_DATA, fetch the original split document contents
      if (!targetUrl || targetUrl === 'SPLIT_DATA') {
        const contentDoc = await getDoc(doc(db, 'ged_items_files', selectedDossier.id));
        if (contentDoc.exists()) {
          targetUrl = contentDoc.data()?.fileUrl || '';
        }
      }

      if (!targetUrl) {
        setStatusMsg("Erreur : Impossible de localiser la ressource du dossier.");
        return;
      }

      // Helper to merge official stamp, signature and transparent annotations directly onto original background image
      const mergeOverlaysWithBackground = (
        backgroundUrl: string,
        overlaysList: Array<{
          hasSignature?: boolean;
          signatureUrl?: string | null;
          sigPosition?: { x: number; y: number } | null;
          sigSize?: { width: number; height: number } | null;
          hasStamp?: boolean;
          stampUrl?: string | null;
          stampPosition?: { x: number; y: number } | null;
          stampSize?: { width: number; height: number } | null;
          annotation?: string | null;
          annotFontSize?: number;
          annotPosition?: { x: number; y: number } | null;
          annotSize?: { width: number; height: number } | null;
          annotColor?: string | null;
          createdByName?: string | null;
          createdByRole?: string | null;
          createdAt?: string | null;
        }>
      ): Promise<string> => {
        return new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(backgroundUrl);
            return;
          }

          const bgImg = new Image();
          bgImg.crossOrigin = 'anonymous';

          const renderAllOverlays = async () => {
            const scale = canvas.width / 600;

            for (const options of overlaysList) {
              const hasSig = options.hasSignature && options.signatureUrl && options.sigPosition;
              const hasStamp = options.hasStamp && options.stampUrl && options.stampPosition;
              const hasAnnot = options.annotation && options.annotPosition;
              const totalOnPage = (hasSig ? 1 : 0) + (hasStamp ? 1 : 0) + (hasAnnot ? 1 : 0);
              const isGrouped = totalOnPage > 1;
              const isSeparated = totalOnPage === 1;

              const metaText = `${options.createdByName || 'Agent'} (${options.createdByRole || 'Agent DGI'}) - ${options.createdAt ? new Date(options.createdAt).toLocaleDateString() : new Date().toLocaleDateString()}`;

              // 1. Draw Stamp (Sceau)
              if (hasStamp) {
                await new Promise<void>((rStamp) => {
                  const sImg = new Image();
                  sImg.crossOrigin = 'anonymous';
                  sImg.onload = () => {
                    const w = options.stampSize?.width ?? 80;
                    const h = options.stampSize?.height ?? 80;
                    const targetW = w * scale;
                    const targetH = h * scale;
                    const targetX = (options.stampPosition!.x / 100) * canvas.width - (targetW / 2);
                    const targetY = (options.stampPosition!.y / 100) * canvas.height - (targetH / 2);
                    
                    ctx.drawImage(sImg, targetX, targetY, targetW, targetH);
                    rStamp();
                  };
                  sImg.onerror = () => rStamp();
                  sImg.src = options.stampUrl!;
                });
              }

              // 2. Draw Handdrawn Signature
              if (hasSig) {
                await new Promise<void>((rSig) => {
                  const sigImg = new Image();
                  sigImg.crossOrigin = 'anonymous';
                  sigImg.onload = () => {
                    const w = options.sigSize?.width ?? 120;
                    const h = options.sigSize?.height ?? 60;
                    const targetW = w * scale;
                    const targetH = h * scale;
                    const targetX = (options.sigPosition!.x / 100) * canvas.width - (targetW / 2);
                    const targetY = (options.sigPosition!.y / 100) * canvas.height - (targetH / 2);
                    
                    ctx.drawImage(sigImg, targetX, targetY, targetW, targetH);
                    rSig();
                  };
                  sigImg.onerror = () => rSig();
                  sigImg.src = options.signatureUrl!;
                });
              }

              // 3. Draw Transparent Annotation (Visa text) matching styling
              if (hasAnnot) {
                const aW = options.annotSize?.width ?? 180;
                const aH = options.annotSize?.height ?? 75;
                const targetW = aW * scale;

                const centerX = (options.annotPosition!.x / 100) * canvas.width;
                const centerY = (options.annotPosition!.y / 100) * canvas.height;
                const targetX = centerX - (targetW / 2);
                const targetY = centerY - (aH * scale / 2);

                ctx.fillStyle = options.annotColor || "#1A5276";
                
                const chosenFontSize = options.annotFontSize || 10;
                const fontSize = Math.max(6, Math.round(chosenFontSize * scale));
                ctx.font = `bold ${fontSize}px monospace`;
                ctx.textBaseline = 'top';

                const fullText = options.annotation!;
                const words = fullText.split(' ');
                let currentLine = '';
                let drawY = targetY + (4 * scale);
                const maxLineWidth = targetW - (10 * scale);

                for (let i = 0; i < words.length; i++) {
                  const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                  const testWidth = ctx.measureText(testLine).width;
                  if (testWidth > maxLineWidth && i > 0) {
                    ctx.fillText(currentLine, targetX + (4 * scale), drawY);
                    currentLine = words[i];
                    drawY += fontSize + (3 * scale);
                  } else {
                    currentLine = testLine;
                  }
                }
                if (currentLine) {
                  ctx.fillText(currentLine, targetX + (4 * scale), drawY);
                }
              }
            }

            try {
              resolve(canvas.toDataURL('image/jpeg', 0.95));
            } catch (err) {
              console.warn("Could not export merged image canvas:", err);
              resolve(backgroundUrl);
            }
          };

          bgImg.onload = () => {
            canvas.width = bgImg.naturalWidth || 1240;
            canvas.height = bgImg.naturalHeight || 1754;
            ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
            renderAllOverlays();
          };

          bgImg.onerror = () => {
            // Failsafe document representation if the image is broken/cors limited
            canvas.width = 1240;
            canvas.height = 1754;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(40, 40, canvas.width - 80, canvas.height - 80);
            
            ctx.fillStyle = '#2c3e50';
            ctx.font = '24px sans-serif';
            ctx.fillText("[ ARCHIVE DOUBLAGE DE TRAITEMENT DGI - DOCUMENT SELECTIONNE ]", 100, 100);
            renderAllOverlays();
          };

          const isPdf = backgroundUrl.startsWith('data:application/pdf') || (backgroundUrl.startsWith('data:') && backgroundUrl.includes('pdf')) || backgroundUrl.endsWith('.pdf');

          if (isPdf) {
            // Decrypt/Parse PDF and draw its first page onto the canvas using PDF.js
            const loadPdfJs = (): Promise<any> => {
              return new Promise((resolvePdf, rejectPdf) => {
                if ((window as any).pdfjsLib) {
                  resolvePdf((window as any).pdfjsLib);
                  return;
                }
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
                script.onload = () => {
                  const pdfjsLib = (window as any).pdfjsLib;
                  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                  resolvePdf(pdfjsLib);
                };
                script.onerror = () => rejectPdf(new Error("Failed to load PDF.js script"));
                document.body.appendChild(script);
              });
            };

            const renderPdfToCanvas = async () => {
              try {
                const pdfjsLib = await loadPdfJs();
                let pdfData: Uint8Array;
                if (backgroundUrl.startsWith('data:')) {
                  const base64Index = backgroundUrl.indexOf(';base64,');
                  const base64Str = backgroundUrl.substring(base64Index + 8);
                  const raw = window.atob(base64Str);
                  const rawLength = raw.length;
                  pdfData = new Uint8Array(new ArrayBuffer(rawLength));
                  for (let i = 0; i < rawLength; i++) {
                    pdfData[i] = raw.charCodeAt(i);
                  }
                } else {
                  let fetchUrl = backgroundUrl;
                  if (fetchUrl.startsWith('http://') || fetchUrl.startsWith('https://')) {
                    fetchUrl = `/api/proxy-pdf?url=${encodeURIComponent(fetchUrl)}`;
                  }
                  const res = await fetch(fetchUrl);
                  const blob = await res.blob();
                  const arrayBuf = await blob.arrayBuffer();
                  pdfData = new Uint8Array(arrayBuf);
                }

                const loadingTask = pdfjsLib.getDocument({ data: pdfData });
                const pdfDocument = await loadingTask.promise;
                const page = await pdfDocument.getPage(1);
                
                // Set high quality resolution target (e.g. scale 2.0 for 1754 A4 proportional render)
                const viewport = page.getViewport({ scale: 2.0 });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                await page.render({ canvasContext: ctx, viewport }).promise;
                await renderAllOverlays();
              } catch (err) {
                console.error("PDF.js render error inside export, using safety fallback DGI letterhead style:", err);
                
                // Let's draw an elegant minimalist A4 template of official DGI letterhead to hold overlays
                canvas.width = 1240;
                canvas.height = 1754;
                ctx.fillStyle = '#fbfcfd';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                ctx.lineWidth = 4;
                ctx.strokeStyle = '#1A5276';
                ctx.strokeRect(30, 30, canvas.width - 60, canvas.height - 60);

                ctx.fillStyle = '#1A5276';
                ctx.font = 'bold 30px monospace';
                ctx.textAlign = 'center';
                ctx.fillText("DIRECTION GÉNÉRALE DES IMPÔTS (DGI)", canvas.width / 2, 120);

                ctx.fillStyle = '#475569';
                ctx.font = '20px monospace';
                ctx.fillText(`DOSSIER DE SCELLAGE DGI : ${selectedDossier.name.toUpperCase()}`, canvas.width / 2, 175);

                ctx.strokeStyle = '#1A5276';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(100, 215);
                ctx.lineTo(canvas.width - 100, 215);
                ctx.stroke();

                ctx.textAlign = 'left';
                await renderAllOverlays();
              }
            };

            renderPdfToCanvas();
          } else {
            bgImg.src = backgroundUrl;
          }
        });
      };

      // Check if we are downloading a specific version that has stamp/signature/annotation overlays,
      // and perform dynamic canvas-based sealing directly onto the original document (multi-layer tracking)
      const hasActiveUnsaved = !versionNum && (includeSignature || includeStamp || annotationText.trim() !== '');

      const targetVersions = [...(selectedDossier.versions || [])].filter(v => {
        if (versionNum) return v.version <= versionNum;
        return true;
      });

      if (hasActiveUnsaved) {
        targetVersions.push({
          version: (selectedDossier.versions?.length || 0) + 1,
          hasSignature: includeSignature && !!user?.signatureUrl,
          signatureUrl: user?.signatureUrl || '',
          sigPosition: sigPosition,
          sigSize: sigSize,
          sigPage: applySigAllPages ? 'all' : String(activePdfPage),
          hasStamp: includeStamp && !!user?.stampUrl,
          stampUrl: user?.stampUrl || '',
          stampPosition: stampPosition,
          stampSize: stampSize,
          stampPage: applyStampAllPages ? 'all' : String(activePdfPage),
          annotation: annotationText,
          annotFontSize: annotationFontSize,
          annotPosition: annotPosition,
          annotSize: annotSize,
          annotPage: applyAnnotAllPages ? 'all' : String(activePdfPage),
          annotColor: annotationColor,
          createdByName: user?.displayName || 'Agent',
          createdByRole: user?.poste || 'Agent DGI',
          createdAt: new Date().toISOString()
        } as any);
      }

      const hasOverlays = targetVersions.some(v => v.hasSignature || v.hasStamp || v.annotation);

      if (hasOverlays) {
        setStatusMsg("Fusion des sceaux et signatures accumulés directement sur le document d'origine...");
        try {
          const resolvedOverlaysList = await Promise.all(targetVersions.map(async (verObj) => {
            let resolvedSigUrl = verObj.signatureUrl || '';
            let resolvedStampUrl = verObj.stampUrl || '';

            if (verObj.hasSignature && resolvedSigUrl === 'SPLIT_DATA') {
              try {
                const sigDoc = await getDoc(doc(db, 'ged_items_files', `${selectedDossier.id}_v${verObj.version}_sig`));
                if (sigDoc.exists()) {
                  resolvedSigUrl = sigDoc.data()?.fileUrl || '';
                }
              } catch (err) {
                console.error(`Error loading split signature for V${verObj.version}:`, err);
              }
            }

            if (verObj.hasStamp && resolvedStampUrl === 'SPLIT_DATA') {
              try {
                const stampDoc = await getDoc(doc(db, 'ged_items_files', `${selectedDossier.id}_v${verObj.version}_stamp`));
                if (stampDoc.exists()) {
                  resolvedStampUrl = stampDoc.data()?.fileUrl || '';
                }
              } catch (err) {
                console.error(`Error loading split stamp for V${verObj.version}:`, err);
              }
            }

            return {
              hasSignature: verObj.hasSignature,
              signatureUrl: resolvedSigUrl,
              sigPosition: verObj.sigPosition,
              sigSize: verObj.sigSize,
              sigPage: verObj.sigPage || null,
              hasStamp: verObj.hasStamp,
              stampUrl: resolvedStampUrl,
              stampPosition: verObj.stampPosition,
              stampSize: verObj.stampSize,
              stampPage: verObj.stampPage || null,
              annotation: verObj.annotation,
              annotFontSize: verObj.annotFontSize,
              annotPosition: verObj.annotPosition,
              annotSize: verObj.annotSize,
              annotPage: verObj.annotPage || null,
              annotColor: verObj.annotColor || null,
              createdByName: verObj.createdByName || 'Agent',
              createdByRole: verObj.createdByRole || 'Agent DGI',
              createdAt: verObj.createdAt || null
            };
          }));

          const ext = (selectedDossier.extension || 'pdf').toLowerCase();
          
          if (ext === 'pdf') {
            setStatusMsg("Génération du document PDF multi-pages haute fidélité...");
            const pdfjsLib = await loadPdfJsGlobally();
            
            // 1. Fetch PDF Data
            let pdfData: Uint8Array;
            if (targetUrl.startsWith('data:')) {
              const base64Index = targetUrl.indexOf(';base64,');
              const base64Str = targetUrl.substring(base64Index + 8);
              const raw = window.atob(base64Str);
              const rawLength = raw.length;
              pdfData = new Uint8Array(new ArrayBuffer(rawLength));
              for (let i = 0; i < rawLength; i++) {
                pdfData[i] = raw.charCodeAt(i);
              }
            } else {
              let fetchUrl = targetUrl;
              if (fetchUrl.startsWith('http://') || fetchUrl.startsWith('https://')) {
                fetchUrl = `/api/proxy-pdf?url=${encodeURIComponent(fetchUrl)}`;
              }
              const res = await fetch(fetchUrl);
              const blob = await res.blob();
              const arrayBuf = await blob.arrayBuffer();
              pdfData = new Uint8Array(arrayBuf);
            }

            const loadingTask = pdfjsLib.getDocument({ data: pdfData });
            const pdfDocument = await loadingTask.promise;
            const numPages = pdfDocument.numPages;

            const pdfExport = new jsPDF({
              orientation: 'portrait',
              unit: 'px',
              format: 'a4'
            });
            const pdfW = pdfExport.internal.pageSize.getWidth();
            const pdfH = pdfExport.internal.pageSize.getHeight();

            const renderCanvas = document.createElement('canvas');
            const renderCtx = renderCanvas.getContext('2d')!;

            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
              if (pageNum > 1) {
                pdfExport.addPage();
              }
              setStatusMsg(`Fidélisation de la page ${pageNum} sur ${numPages}...`);

              try {
                const page = await pdfDocument.getPage(pageNum);
                const viewport = page.getViewport({ scale: 2.0 }); // High-quality print scaling
                renderCanvas.width = viewport.width;
                renderCanvas.height = viewport.height;
                
                renderCtx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
                await page.render({ canvasContext: renderCtx, viewport }).promise;

                // Draw overlays that apply to this page
                for (const overlay of resolvedOverlaysList) {
                  // Checks
                  const signatureApplies = overlay.hasSignature && overlay.signatureUrl && 
                    (!overlay.sigPage || overlay.sigPage === 'all' || Number(overlay.sigPage) === pageNum);

                  const stampApplies = overlay.hasStamp && overlay.stampUrl && 
                    (!overlay.stampPage || overlay.stampPage === 'all' || Number(overlay.stampPage) === pageNum);

                  const annotationApplies = overlay.annotation && overlay.annotPosition && 
                    (!overlay.annotPage || overlay.annotPage === 'all' || Number(overlay.annotPage) === pageNum);

                  const scaleFactor = renderCanvas.width / 600;

                  const totalOnPage = (signatureApplies ? 1 : 0) + (stampApplies ? 1 : 0) + (annotationApplies ? 1 : 0);
                  const isGrouped = totalOnPage > 1;
                  const isSeparated = totalOnPage === 1;

                  const metaText = `${overlay.createdByName || 'Agent'} (${overlay.createdByRole || 'Agent DGI'}) - ${overlay.createdAt ? new Date(overlay.createdAt).toLocaleDateString() : new Date().toLocaleDateString()}`;

                  // 1. Stamp
                  if (stampApplies) {
                    await new Promise<void>((rStamp) => {
                      const stampImg = new Image();
                      stampImg.onload = () => {
                        const sW = (overlay.stampSize?.width ?? 80) * scaleFactor;
                        const sH = (overlay.stampSize?.height ?? 80) * scaleFactor;
                        const sX = ((overlay.stampPosition?.x ?? 25) / 100) * renderCanvas.width - (sW / 2);
                        const sY = ((overlay.stampPosition?.y ?? 75) / 100) * renderCanvas.height - (sH / 2);
                        renderCtx.drawImage(stampImg, sX, sY, sW, sH);
                        rStamp();
                      };
                      stampImg.onerror = () => rStamp();
                      stampImg.src = overlay.stampUrl!;
                    });
                  }

                  // 2. Signature
                  if (signatureApplies) {
                    await new Promise<void>((rSig) => {
                      const sigImg = new Image();
                      sigImg.onload = () => {
                        const sW = (overlay.sigSize?.width ?? 120) * scaleFactor;
                        const sH = (overlay.sigSize?.height ?? 60) * scaleFactor;
                        const sX = ((overlay.sigPosition?.x ?? 65) / 100) * renderCanvas.width - (sW / 2);
                        const sY = ((overlay.sigPosition?.y ?? 75) / 100) * renderCanvas.height - (sH / 2);
                        renderCtx.drawImage(sigImg, sX, sY, sW, sH);
                        rSig();
                      };
                      sigImg.onerror = () => rSig();
                      sigImg.src = overlay.signatureUrl!;
                    });
                  }

                  // 3. Annotation
                  if (annotationApplies) {
                    const aW = overlay.annotSize?.width ?? 180;
                    const aH = overlay.annotSize?.height ?? 75;
                    const targetAnnotW = aW * scaleFactor;
                    const targetAnnotH = aH * scaleFactor;

                    const centerX = ((overlay.annotPosition?.x ?? 45) / 100) * renderCanvas.width;
                    const centerY = ((overlay.annotPosition?.y ?? 35) / 100) * renderCanvas.height;
                    const targetX = centerX - (targetAnnotW / 2);
                    const targetY = centerY - (targetAnnotH / 2);

                    renderCtx.fillStyle = overlay.annotColor || '#1A5276';
                    const chosenFontSize = overlay.annotFontSize || 10;
                    const fontSizeSpec = Math.max(8, Math.round(chosenFontSize * scaleFactor));
                    renderCtx.font = `bold ${fontSizeSpec}px monospace`;
                    renderCtx.textBaseline = 'top';

                    const words = overlay.annotation.split(' ');
                    let currentLine = '';
                    let drawY = targetY + (6 * scaleFactor);
                    const maxLineWidth = targetAnnotW - (12 * scaleFactor);

                    for (let i = 0; i < words.length; i++) {
                      const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                      const testWidth = renderCtx.measureText(testLine).width;
                      if (testWidth > maxLineWidth && i > 0) {
                        renderCtx.fillText(currentLine, targetX + (6 * scaleFactor), drawY);
                        currentLine = words[i];
                        drawY += fontSizeSpec + (4 * scaleFactor);
                      } else {
                        currentLine = testLine;
                      }
                    }
                    if (currentLine) {
                      renderCtx.fillText(currentLine, targetX + (6 * scaleFactor), drawY);
                    }
                  }
                }
                
                const pageDataUrl = renderCanvas.toDataURL('image/jpeg', 0.95);
                pdfExport.addImage(pageDataUrl, 'JPEG', 0, 0, pdfW, pdfH, undefined, 'FAST');
              } catch (pageErr) {
                console.error(`Page ${pageNum} compile error:`, pageErr);
              }
            }

            pdfExport.save(selectedDossier.name + `_V${versionNum}.pdf`);
          } else {
            const mergedBase64 = await mergeOverlaysWithBackground(targetUrl, resolvedOverlaysList);
            const link = document.createElement('a');
            link.href = mergedBase64;
            link.download = selectedDossier.name + `_V${versionNum}.${ext}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }
          
          setStatusMsg(`Version V${versionNum} traitée et téléchargée avec succès !`);
          return;
        } catch (err) {
          console.error("Canvas blending failed, falling back:", err);
        }
      }

      let downloadUrl = targetUrl;
      let isBlobUrlCreated = false;

      // Convert dataURI to local object URL for absolute download reliability in sandboxed preview frames
      if (targetUrl.startsWith('data:')) {
        try {
          const blob = dataURItoBlob(targetUrl);
          downloadUrl = URL.createObjectURL(blob);
          isBlobUrlCreated = true;
        } catch (e) {
          console.error("Failed to convert download URL to Blob URL:", e);
        }
      }

      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = selectedDossier.name + (versionNum ? `_V${versionNum}` : '') + "." + (selectedDossier.extension || 'pdf');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (isBlobUrlCreated) {
        // Set short timeout to authorize browser completion of anchor clicking stream before revoking
        setTimeout(() => {
          URL.revokeObjectURL(downloadUrl);
        }, 3000);
      }

      setStatusMsg("Téléchargement initié avec succès !");
    } catch (err: any) {
      console.error(err);
      setStatusMsg("Erreur lors de la récupération du fichier : " + err.message);
    }
  };

  const handleDeleteDossier = async (e: React.MouseEvent, dossierId: string) => {
    e.stopPropagation();
    if (!user) return;
    
    if (user.email !== 'sibinimigjc@gmail.com') {
      alert("Action non autorisée");
      return;
    }
    
    const confirmDelete = window.confirm("Êtes-vous absolument sûr de vouloir supprimer définitivement ce dossier ? Cette opération est irréversible.");
    if (!confirmDelete) return;

    try {
      setStatusMsg("Suppression définitive du dossier en cours...");
      
      // 1. Delete Firestore main document
      await deleteDoc(doc(db, 'ged_items', dossierId));
      
      // 2. Delete Firestore oversized sidecar files if present
      try {
        await deleteDoc(doc(db, 'ged_items_files', dossierId));
      } catch (_) {}

      // 3. Remove from LocalStorage cache
      const cached = localStorage.getItem('cache_ged_items_administrative');
      if (cached) {
        const list = JSON.parse(cached) as GedItem[];
        const updated = list.filter(item => item.id !== dossierId);
        localStorage.setItem('cache_ged_items_administrative', JSON.stringify(updated));
        setDossiers(updated);
      }

      if (selectedDossier?.id === dossierId) {
        setSelectedDossier(null);
      }

      setStatusMsg("Dossier supprimé définitivement avec succès !");
    } catch (err: any) {
      console.error("Error deleting dossier:", err);
      setStatusMsg(`Erreur lors de la suppression : ${err.message || err}`);
    }
  };

  // FILTER LOGIC
  const filteredDossiers = dossiers.filter(d => {
    const sLower = searchTerm.toLowerCase();
    const matchesSearch = d.name.toLowerCase().includes(sLower) || 
                          (d.createdBy?.displayName || '').toLowerCase().includes(sLower);
    if (!matchesSearch) return false;

    if (statusFilter === 'Tous') return true;
    if (statusFilter === 'En attente') {
      return d.secretariatWaiting === true;
    }
    if (statusFilter === 'Historique de transit') {
      return d.processedByUids?.includes(user?.uid || '');
    }
    return d.status === statusFilter;
  });

  // Transit Rules Determination
  const getTransferOptions = () => {
    if (!user) return [];
    const perimetre = user.perimetre || 'gestionnaire';

    // 1. Secrétariat or admin can transfer to any available perimeter
    if (perimetre === 'secretariat' || user.role === 'admin') {
      return [
        { key: 'secretariat', label: 'Secrétariat Général' },
        { key: 'gestionnaire', label: 'Service Gestionnaires DGI' },
        { key: 'admin_bureau', label: 'Administration du Bureau' },
        { key: 'superviseur', label: 'Superviseurs' },
        { key: 'superviseur_senior', label: 'Superviseur Admin Senior' },
      ];
    }

    // 2. Chef rules: 'Superviseur Admin Senior', 'Superviseur Admin', 'Administrateur de Bureau'
    const isChef = ['admin_bureau', 'superviseur', 'superviseur_senior'].includes(perimetre);
    if (isChef) {
      const baseOptions = [{ key: 'secretariat', label: 'Secrétariat Général' }];
      
      // EXCEPTION DIRECTE : A Chef can transfer to a 'Gestionnaire' ONLY if that dossier is formally assigned to that gestionnaire
      if (selectedDossier?.assignedAgentId) {
        baseOptions.push({ key: 'gestionnaire', label: `Gestionnaire Attribué (${selectedDossier.assignedAgentName || 'Agent'})` });
      }
      return baseOptions;
    }

    // 3. Gestionnaire can transfer ONLY to Secrétariat
    if (perimetre === 'gestionnaire') {
      return [{ key: 'secretariat', label: 'Secrétariat Général' }];
    }

    return [{ key: 'secretariat', label: 'Secrétariat Général' }];
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-80px)] w-full overflow-hidden bg-[#FAFCFF] relative">
      
      {/* Toast Notification Banner */}
      <AnimatePresence>
        {statusMsg && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-[#2C3E50] text-[#FAFCFF] px-6 py-3 rounded-full text-xs font-bold uppercase tracking-wider shadow-2xl border border-teal-500/30 flex items-center gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span>{statusMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LEFT SIDEBAR: ACTIVE DOSSIERS LIST */}
      <div className={`${viewMode === 'list' ? 'block w-full' : 'hidden'} lg:block lg:w-96 border-r border-[#EBF2FA] flex flex-col h-full bg-white flex-shrink-0`}>
        <div className="p-6 border-b border-[#EBF2FA]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FolderGit size={20} className="text-[#34495E]" />
              <h1 className="text-sm font-black text-[#2C3E50] uppercase tracking-wider">Dossiers Internes</h1>
            </div>
            
            {/* Create dossier button */}
            <button 
              onClick={() => setShowCreateModal(true)}
              className="bg-[#2C3E50] text-white hover:bg-[#34495E] p-2 rounded-full transition-all cursor-pointer shadow-md"
              title="Créer un nouveau dossier administratif"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <input 
              type="text"
              placeholder="Rechercher un dossier..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-gray-50/80 border border-gray-100 rounded-2xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#34495E] focus:bg-white"
            />
            <Search size={14} className="absolute left-3 top-3 text-gray-400" />
          </div>

          {/* Status Filters - Adjusted for Workflow Regulation */}
          <div className="flex gap-1.5 mt-4 overflow-x-auto pb-1.5 scrollbar-hide">
            {(() => {
              const tabs = ['Tous', 'Nouveau', 'En cours', 'Terminé / Envoyé', 'Archivé'];
              if (isUserSecretariat(user)) {
                tabs.push('En attente');
              }
              tabs.push('Historique de transit');
              tabs.push('Annulé');
              return tabs.map(st => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                    statusFilter === st 
                      ? 'bg-[#2C3E50] text-[#FAFCFF] shadow-sm' 
                      : 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100'
                  }`}
                >
                  {st === 'Historique de transit' ? 'Transit 🔄' : st}
                </button>
              ));
            })()}
          </div>
        </div>

        {/* Dossiers list container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {filteredDossiers.map(dossier => {
            const isSelected = selectedDossier?.id === dossier.id;
            const currentStatus = dossier.status || 'Nouveau';
            return (
              <div
                key={dossier.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setSelectedDossier(dossier);
                  setActiveTab('details');
                  setViewMode('dossier');
                }}
                onTouchEnd={() => {
                  setSelectedDossier(dossier);
                  setActiveTab('details');
                  setViewMode('dossier');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDossier(dossier);
                    setActiveTab('details');
                    setViewMode('dossier');
                  }
                }}
                className={`w-full text-left p-4 rounded-3xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 focus:outline-none focus:ring-2 focus:ring-[#2C3E50]/20 ${
                  isSelected 
                    ? 'bg-[#2C3E50]/5 border-[#2C3E50]/15' 
                    : 'bg-white border-gray-100 hover:border-gray-200 hover:bg-gray-50/50'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.05em] border ${
                    currentStatus === 'Nouveau' ? 'bg-blue-50 text-blue-700 border-blue-100' :
                    currentStatus === 'En cours' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                    currentStatus === 'Terminé / Envoyé' ? 'bg-green-50 text-green-700 border-green-100' :
                    currentStatus === 'Annulation en attente de confirmation' ? 'bg-rose-50 text-rose-700 border-rose-150 animate-pulse' :
                    currentStatus === 'Annulé' ? 'bg-red-100 text-red-800 border-red-200 font-extrabold' :
                    'bg-gray-100 text-gray-700 border-gray-200'
                  }`}>
                    {currentStatus}
                  </span>
                  
                  <div className="flex items-center gap-2">
                    {dossier.isLocked && (
                      <Lock size={12} className="text-gray-400" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => handleDeleteDossier(e, dossier.id)}
                      className={`p-1.5 rounded-full transition-all cursor-pointer ${
                        user?.email === 'sibinimigjc@gmail.com'
                          ? 'text-red-500 hover:bg-red-50 hover:scale-110'
                          : 'text-gray-200 hover:text-red-400 hover:bg-gray-100/50'
                      }`}
                      title={user?.email === 'sibinimigjc@gmail.com' ? "Supprimer définitivement" : "Action restreinte"}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                <p className="text-xs font-extrabold text-gray-900 leading-normal line-clamp-2">
                  {dossier.name}
                </p>

                {dossier.secretariatWaiting && (
                  <div className="mt-1 bg-amber-50 border border-amber-250 text-amber-850 text-[8px] font-black px-2 py-1 rounded-2xl uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-ping shrink-0" />
                    <span className="truncate">Attente : {dossier.waitingForReturnFrom}</span>
                  </div>
                )}

                <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1 pt-2 border-t border-gray-50">
                  <span className="font-bold truncate max-w-[120px]">
                    Par: {dossier.createdBy?.displayName || 'DGI staff'}
                  </span>
                  <span className="font-mono">
                    V{(dossier.versions?.length || 1)}
                  </span>
                </div>
              </div>
            );
          })}

          {filteredDossiers.length === 0 && (
            <div className="text-center py-12 px-4 text-gray-400">
              <FolderGit size={32} className="mx-auto mb-2 text-gray-300 animate-pulse" />
              <p className="text-xs font-black uppercase tracking-wider">Aucun dossier en cours.</p>
              <p className="text-[10px] text-gray-400 font-medium mt-1">Cliquez sur '+' pour créer votre premier dossier.</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR: DOSSIER WORKFLOW ROOM */}
      <div className={`${viewMode === 'dossier' ? 'flex w-full' : 'hidden'} lg:flex lg:flex-1 flex-col h-full bg-[#FAFCFF] overflow-hidden relative`}>
        
        {/* BOUTON RETOUR INDESTRUCTIBLE (Mobile/Tablet Only) */}
        <div className="lg:hidden w-full bg-white border-b border-[#EBF2FA] p-4 flex items-center justify-between flex-shrink-0 z-30 shadow-sm">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className="flex items-center gap-2 px-4 py-2 bg-[#2C3E50] text-[#FAFCFF] hover:bg-[#34495E] rounded-full text-[10px] font-black uppercase tracking-widest cursor-pointer shadow-md transition-all active:scale-95"
          >
            ⬅️ Retour aux dossiers
          </button>
          
          <span className="text-[9px] font-black uppercase text-gray-400 tracking-widest truncate max-w-[150px]">
            {selectedDossier ? selectedDossier.name : "Sélection Administrative"}
          </span>
        </div>

        {selectedDossier ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            
            {/* Top Detail Header status tracks / actions */}
            <div className="bg-white border-b border-[#EBF2FA] p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0">
              <div>
                <p className="text-[10px] font-black tracking-widest uppercase text-gray-400 mb-1">
                  Dossier administratif interne de validation
                </p>
                <h2 className="text-sm font-black text-[#263238] uppercase tracking-wide truncate max-w-lg">
                  {selectedDossier.name}
                </h2>
                {selectedDossier.openedByRecipientAt && selectedDossier.lastDispatcherId === user.uid && (
                  <p className="text-[10px] text-green-700 font-bold uppercase tracking-wider mt-1.5 flex items-center gap-1 bg-green-50 px-2.5 py-1 rounded-xl border border-green-100 w-fit">
                    👁️ Vu par <b className="font-extrabold">{selectedDossier.openedByRecipientName}</b> le {new Date(selectedDossier.openedByRecipientAt).toLocaleString('fr-FR')}
                  </p>
                )}
              </div>

              {/* Status control buttons - sequence process */}
              <div className="flex items-center gap-2">
                
                {/* Secretariat / Chef de Gestionnaire Cancel Transfer (Droit à l'erreur) */}
                {((user.perimetre === 'secretariat' || user.perimetre === 'admin_bureau' || user.perimetre === 'superviseur' || user.perimetre === 'superviseur_senior' || user.role === 'admin') && selectedDossier.activePerimetre && selectedDossier.activePerimetre !== user.perimetre) && (
                  <button
                    onClick={handleCancelSecretariatTransfer}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-650 hover:bg-red-100 rounded-full text-[10px] font-bold uppercase tracking-wider cursor-pointer border border-red-200 shadow-xs transition-all active:scale-95"
                    title="Annuler le dernier transfert pour erreur de destinataire (Droit à l'erreur)"
                  >
                    ↩️ Annuler transfert
                  </button>
                )}

                {/* Secure Routing: Transfer Action inside dropdown */}
                {!isTransferReadOnly && (
                  <div className="relative">
                    <button
                      onClick={() => setIsTransferOpen(!isTransferOpen)}
                      className="flex items-center gap-2 px-3  py-1.5 bg-[#2C3E50] text-[#FAFCFF] hover:bg-[#34495E] rounded-full text-[10px] font-black uppercase tracking-widest cursor-pointer shadow-sm"
                    >
                      Transférer le dossier <ChevronRight size={12} className={isTransferOpen ? 'rotate-95' : ''} />
                    </button>

                  <AnimatePresence>
                    {isTransferOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 rounded-3xl shadow-2xl p-2 z-50 flex flex-col gap-1.5"
                      >
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-3 pt-2 pb-1 border-b border-gray-50">
                          Route administrative stricte
                        </p>
                        
                        {getTransferOptions().map((opt) => (
                          <button
                            key={opt.key}
                            onClick={() => triggerTransferWithNote(opt.key)}
                            className="w-full text-left px-3 py-2 rounded-2xl hover:bg-[#2C3E50]/5 text-xs font-bold text-[#2C3E50] transition-colors cursor-pointer"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                )}
              </div>
            </div>

            {/* Stepper Tracking steps above dossier content */}
            <div className="bg-white border-b border-[#EBF2FA] px-6 py-3 flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide flex-shrink-0">
              {['Nouveau', 'En cours', 'Terminé / Envoyé', 'Archivé', 'Annulé'].map((st, i) => {
                const isActive = selectedDossier.status === st;
                let activeStyle = 'bg-[#2C3E50] text-[#FAFCFF] font-black uppercase shadow-lg shadow-gray-200';
                if (st === 'Annulé' && isActive) {
                  activeStyle = 'bg-red-600 text-white font-black uppercase shadow-lg shadow-red-200/50 border border-red-700/30';
                }
                const isClickable = !isTransferReadOnly;
                return (
                  <button
                    key={st}
                    disabled={!isClickable}
                    onClick={() => triggerStatusUpdateWithNote(st as any)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-2xl transition-all min-w-[12rem] justify-center ${
                      isClickable ? 'cursor-pointer hover:bg-gray-150' : 'cursor-not-allowed opacity-75'
                    } ${
                      isActive 
                        ? activeStyle 
                        : 'bg-gray-50/50 border border-gray-100 text-gray-400'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                      isActive 
                        ? (st === 'Annulé' ? 'bg-white text-red-600' : 'bg-[#FAFCFF] text-[#2C3E50]') 
                        : 'bg-gray-200 text-gray-500'
                    }`}>
                      {i + 1}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider">{st}</span>
                  </button>
                );
              })}
            </div>

            {/* Tabs for Details vs Chat Internal vs History Logs */}
            <div className="bg-white border-b border-[#EBF2FA] px-6 flex gap-4 flex-shrink-0">
              {[
                { id: 'details', label: 'Espace d\'Étude & signature' },
                { id: 'chat', label: 'Traitement Collaboratif (Chat)' },
                { id: 'logs', label: 'Historique de transit (Inviolable)' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  onTouchStart={() => setActiveTab(tab.id as any)}
                  className={`py-3.5 px-1 relative text-[10px] font-black uppercase tracking-widest cursor-pointer transition-all ${
                    activeTab === tab.id 
                      ? 'text-[#2C3E50]' 
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {tab.label}
                  {activeTab === tab.id && (
                    <motion.div 
                      layoutId="activeSubTab" 
                      className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#2C3E50] rounded-full" 
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Main Tabs contents container */}
            <div className="flex-1 overflow-hidden p-6 relative">
              <AnimatePresence mode="wait">
                
                {/* 1. STUDY AND SIGNING TAB */}
                {activeTab === 'details' && (
                  <motion.div
                    key="details_tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className={`h-full grid grid-cols-1 ${studioZoomMode === 'studio' ? 'lg:grid-cols-12' : 'lg:grid-cols-2'} gap-6 overflow-y-auto pb-8 custom-scrollbar`}
                  >
                    
                    {/* Left panel: File viewer and version history list */}
                    <div className={`${studioZoomMode === 'studio' ? 'lg:col-span-8' : ''} flex flex-col gap-6`}>
                      {/* Document Viewer */}
                      <div className="bg-[#2C3E50] text-[#FAFCFF] p-6 rounded-3xl shadow-xl flex flex-col gap-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full translate-x-12 -translate-y-12" />
                        
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 bg-white/10 rounded-2xl">
                              <FileText size={24} className="text-white" />
                            </div>
                            <div>
                              <p className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Type: PDF d'État original</p>
                              <h3 className="text-xs font-black truncate max-w-[200px]">{selectedDossier.name}</h3>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {selectedDossier.isLocked ? (
                              <div className="flex items-center gap-1.5 bg-red-500/20 text-red-300 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider">
                                <Lock size={10} /> Original Verrouillé
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider">
                                <Unlock size={10} /> Modifiable
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Interactive File Preview Wrapper */}
                        <div className={`bg-white rounded-2xl p-2 border border-gray-100 flex flex-col gap-2 relative bg-opacity-75 backdrop-blur-sm shadow-inner transition-all duration-300 ${studioZoomMode === 'studio' ? 'min-h-[640px]' : 'min-h-[440px]'}`}>
                          <div className="absolute top-2 left-2 z-15 bg-[#2C3E50]/85 text-white text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded shadow flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                            {selectedVersionNum ? `APERCU : VERSION V${selectedVersionNum}` : 'DOCUMENT ORIGINAL INTERACTIF'}
                          </div>
                          
                          <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setStudioZoomMode(studioZoomMode === 'studio' ? 'normal' : 'studio')}
                              className={`text-[9.5px] font-black uppercase tracking-wider px-3 py-1 rounded shadow cursor-pointer transition-all border ${
                                studioZoomMode === 'studio'
                                  ? 'bg-amber-500 hover:bg-amber-600 border-amber-600 text-white animate-pulse'
                                  : 'bg-teal-600 hover:bg-teal-700 border-teal-700 text-white'
                              }`}
                            >
                              📐 {studioZoomMode === 'studio' ? 'Rétrécir' : "Studio (Format Large)"}
                            </button>

                            <button
                              type="button"
                              onClick={() => setIsFullscreenPreviewOpen(true)}
                              className="bg-[#2C3E50] hover:bg-[#34495E] text-white text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded shadow cursor-pointer transition-all border border-transparent hover:scale-105"
                            >
                              🔍 Plein Écran
                            </button>
                          </div>
                          
                          {(() => {
                            if (!activeFileUrl) {
                              return (
                                <div className={`flex-1 flex flex-col bg-zinc-950 rounded-xl overflow-hidden border border-gray-800 relative p-1.5 justify-center items-center text-center transition-all duration-300 ${studioZoomMode === 'studio' ? 'min-h-[580px]' : 'min-h-[380px]'}`}>
                                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1A5276] mb-2" />
                                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Chargement sécurisé du document...</span>
                                </div>
                              );
                            }

                            const isPdfUrl = activeFileUrl?.startsWith('data:application/pdf') || (activeFileUrl?.startsWith('blob:') && selectedDossier.extension?.toLowerCase() === 'pdf') || activeBlobUrl !== '';
                            const isImageUrl = activeFileUrl?.startsWith('data:image/') || activeFileUrl?.includes('unsplash.com') || (!isPdfUrl && ['png', 'jpg', 'jpeg', 'webp'].includes(selectedDossier.extension?.toLowerCase() || ''));
                            const isPdf = isPdfUrl || selectedDossier.extension?.toLowerCase() === 'pdf';
                            
                            const dynHeight = studioZoomMode === 'studio' ? '540px' : '390px';
                            const dynImageMaxHeight = studioZoomMode === 'studio' ? '530px' : '380px';
                            const dynPdfHeight = studioZoomMode === 'studio' ? '530px' : '380px';

                            const pageHasActiveSig = includeSignature && !selectedVersionNum && !!user?.signatureUrl;
                            const pageHasActiveStamp = includeStamp && !selectedVersionNum && !!user?.stampUrl;
                            const pageHasActiveAnnot = !!annotationText && !selectedVersionNum;

                            const activeElementsOnPage = (pageHasActiveSig ? 1 : 0) + (pageHasActiveStamp ? 1 : 0) + (pageHasActiveAnnot ? 1 : 0);
                            const isActiveGrouped = activeElementsOnPage > 1;
                            const isActiveSeparated = activeElementsOnPage === 1;

                            const limitVer = selectedVersionNum || (selectedDossier.versions?.length ? selectedDossier.versions[selectedDossier.versions.length - 1].version : 0);
                            const renderVersions = (selectedDossier.versions || []).filter(v => v.version <= limitVer);

                            return (
                              <div className={`flex-1 flex flex-col bg-zinc-950 rounded-xl overflow-hidden border border-gray-800 relative p-1.5 justify-center items-center transition-all duration-300 ${studioZoomMode === 'studio' ? 'min-h-[580px]' : 'min-h-[380px]'}`}>
                                <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-all duration-300" style={isMobile ? { width: '100%', maxWidth: '100%', aspectRatio: '1 / 1.414', height: 'auto', maxHeight: 'none' } : { height: dynHeight, maxHeight: dynHeight }} ref={previewContainerRef}>
                                  {isImageUrl ? (
                                    <img 
                                      src={activeFileUrl} 
                                      className="max-h-full max-w-full object-contain rounded-lg shadow-2xl select-none transition-all duration-300" 
                                      style={isMobile ? { maxHeight: '100%', maxWidth: '100%' } : { maxHeight: dynImageMaxHeight }}
                                      alt={selectedDossier.name}
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : isPdf ? (
                                    <div className="w-full h-full relative flex items-center justify-center transition-all duration-300" style={isMobile ? { height: '100%', width: '100%' } : { height: dynPdfHeight }}>
                                      {pdfRenderLoading ? (
                                        <div className="flex flex-col items-center justify-center p-6 text-zinc-400">
                                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mb-2" />
                                          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Chargement du document vectoriel...</p>
                                        </div>
                                      ) : (
                                        <div className="relative w-full h-full flex items-center justify-center overflow-auto">
                                          <canvas 
                                            ref={previewCanvasRef} 
                                            className="max-h-full max-w-full object-contain rounded-lg shadow-2xl bg-white select-none transition-all duration-300"
                                            style={isMobile ? { maxHeight: '100%', maxWidth: '100%' } : { maxHeight: dynPdfHeight }}
                                          />
                                        </div>
                                      )}

                                      {/* Float pagination toolbar */}
                                      {pdfPagesCount > 1 && (
                                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-zinc-900/90 border border-zinc-700/80 px-4 py-1.5 rounded-full shadow-2xl z-20">
                                          <button
                                            type="button"
                                            disabled={activePdfPage <= 1}
                                            onClick={() => setActivePdfPage(prev => Math.max(1, prev - 1))}
                                            className="p-1 text-white hover:text-teal-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                            title="Page précédente"
                                          >
                                            <span className="text-xs font-black select-none">◀</span>
                                          </button>
                                          <span className="text-white text-[10px] font-black uppercase tracking-wider select-none min-w-[90px] text-center">
                                            Page {activePdfPage} / {pdfPagesCount}
                                          </span>
                                          <button
                                            type="button"
                                            disabled={activePdfPage >= pdfPagesCount}
                                            onClick={() => setActivePdfPage(prev => Math.min(pdfPagesCount, prev + 1))}
                                            className="p-1 text-white hover:text-teal-400 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                            title="Page suivante"
                                          >
                                            <span className="text-xs font-black select-none">▶</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex flex-col items-center justify-center bg-zinc-900 rounded-xl p-6 min-h-[285px] text-zinc-400">
                                      <FileText className="text-zinc-600 mb-2" size={48} />
                                      <p className="text-xs font-black text-gray-300 uppercase tracking-widest">{selectedDossier.name}</p>
                                      <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mt-1">Format: .{(selectedDossier.extension || 'PDF').toUpperCase()}</p>
                                    </div>
                                  )}

                                  {/* Draggable user signature layer */}
                                  {includeSignature && !selectedVersionNum && user?.signatureUrl && (
                                    <div 
                                      style={{
                                        position: 'absolute',
                                        left: `${sigPosition.x}%`,
                                        top: `${sigPosition.y}%`,
                                        width: `${sigSize.width}px`,
                                        height: `${sigSize.height}px`,
                                        transform: 'translate(-50%, -50%)',
                                        cursor: 'move',
                                      }}
                                      onMouseDown={(e) => startDrag(e, 'signature')}
                                      onTouchStart={(e) => startDrag(e, 'signature')}
                                      className="absolute border-2 border-dashed border-teal-500 bg-teal-50/15 hover:bg-teal-50/30 group rounded shadow-lg touch-none z-[40]"
                                    >
                                      <img 
                                        src={user.signatureUrl} 
                                        className="w-full h-full object-contain pointer-events-none mix-blend-multiply" 
                                        alt="Votre signature"
                                        referrerPolicy="no-referrer"
                                      />
                                      {/* Corner resize handle */}
                                      <div 
                                        onMouseDown={(e) => startResize(e, 'signature')}
                                        onTouchStart={(e) => startResize(e, 'signature')}
                                        className="absolute bottom-[-8px] right-[-8px] w-5 h-5 bg-teal-600 hover:bg-teal-700 rounded-full border border-white cursor-se-resize flex items-center justify-center shadow-lg z-[45]"
                                      >
                                        <span className="text-[10px] text-white font-extrabold select-none">⤡</span>
                                      </div>
                                    </div>
                                  )}
 
                                  {/* Draggable official stamp layer */}
                                  {includeStamp && !selectedVersionNum && (
                                    <div 
                                      style={{
                                        position: 'absolute',
                                        left: `${stampPosition.x}%`,
                                        top: `${stampPosition.y}%`,
                                        width: `${stampSize.width}px`,
                                        height: `${stampSize.height}px`,
                                        transform: 'translate(-50%, -50%)',
                                        cursor: 'move',
                                      }}
                                      onMouseDown={(e) => startDrag(e, 'stamp')}
                                      onTouchStart={(e) => startDrag(e, 'stamp')}
                                      className="absolute border-2 border-dashed border-red-500 bg-red-50/15 hover:bg-red-50/30 group rounded shadow-lg touch-none z-[40]"
                                    >
                                      {user?.stampUrl ? (
                                        <img 
                                          src={user.stampUrl} 
                                          className="w-full h-full object-contain pointer-events-none mix-blend-multiply" 
                                          alt="Sceau Officiel"
                                          referrerPolicy="no-referrer"
                                        />
                                      ) : (
                                        <div className="w-full h-full text-red-500 bg-red-50/80 border border-red-200 text-[8px] font-black p-1.5 flex flex-col items-center justify-center text-center">
                                          Sceau non configuré
                                        </div>
                                      )}
                                      {/* Corner resize handle */}
                                      <div 
                                        onMouseDown={(e) => startResize(e, 'stamp')}
                                        onTouchStart={(e) => startResize(e, 'stamp')}
                                        className="absolute bottom-[-8px] right-[-8px] w-5 h-5 bg-red-650 hover:bg-red-700 rounded-full border border-white cursor-se-resize flex items-center justify-center shadow-lg z-[45]"
                                      >
                                        <span className="text-[10px] text-white font-extrabold select-none">⤡</span>
                                      </div>
                                    </div>
                                  )}
 
                                  {/* Draggable official annotation/visa card layer */}
                                  {annotationText && !selectedVersionNum && (
                                    <div 
                                      style={{
                                        position: 'absolute',
                                        left: `${annotPosition.x}%`,
                                        top: `${annotPosition.y}%`,
                                        width: `${annotSize.width}px`,
                                        height: `${annotSize.height}px`,
                                        transform: 'translate(-50%, -50%)',
                                        cursor: 'move',
                                      }}
                                      onMouseDown={(e) => startDrag(e, 'annotation')}
                                      onTouchStart={(e) => startDrag(e, 'annotation')}
                                      className="absolute border-2 border-dashed border-slate-500 bg-transparent p-2 leading-tight flex flex-col justify-between group rounded-xl touch-none z-[40] pointer-events-auto"
                                    >
                                      <div 
                                        style={{ fontSize: `${annotationFontSize}px`, color: annotationColor }}
                                        className="font-mono font-black break-words pointer-events-none select-none max-h-full overflow-hidden uppercase tracking-wider leading-relaxed"
                                      >
                                        {annotationText}
                                      </div>
                                      {/* Corner resize handle */}
                                      <div 
                                        onMouseDown={(e) => startResize(e, 'annotation')}
                                        onTouchStart={(e) => startResize(e, 'annotation')}
                                        className="absolute bottom-[-8px] right-[-8px] w-5 h-5 bg-slate-600 hover:bg-slate-700 rounded-full border border-white cursor-se-resize flex items-center justify-center shadow-lg z-[45]"
                                      >
                                        <span className="text-[10px] text-white font-extrabold select-none">⤡</span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Render absolute-placed overlay layers from selected version history metadata */}
                                  {(() => {
                                    const limitVer = selectedVersionNum || (selectedDossier.versions?.length ? selectedDossier.versions[selectedDossier.versions.length - 1].version : 0);
                                    const renderVersions = (selectedDossier.versions || []).filter(v => v.version <= limitVer);
 
                                    return renderVersions.map((verObj) => {
                                      const displaySigUrl = verObj.signatureUrl === 'SPLIT_DATA'
                                        ? (loadedOverlays[verObj.version]?.signatureUrl || '')
                                        : (verObj.signatureUrl || '');
 
                                      const displayStampUrl = verObj.stampUrl === 'SPLIT_DATA'
                                        ? (loadedOverlays[verObj.version]?.stampUrl || '')
                                        : (verObj.stampUrl || '');
 
                                      const hasVerSig = verObj.hasSignature && displaySigUrl && (pdfPagesCount <= 1 || verObj.sigPage === 'all' || (Number(verObj.sigPage) || 1) === activePdfPage);
                                      const hasVerStamp = verObj.hasStamp && displayStampUrl && (pdfPagesCount <= 1 || verObj.stampPage === 'all' || (Number(verObj.stampPage) || 1) === activePdfPage);
                                      const hasVerAnnot = !!verObj.annotation && (pdfPagesCount <= 1 || verObj.annotPage === 'all' || (Number(verObj.annotPage) || 1) === activePdfPage);
 
                                      return (
                                        <React.Fragment key={verObj.version}>
                                          {/* Historic Signature Layer */}
                                          {hasVerSig && (
                                            <div 
                                              style={{
                                                position: 'absolute',
                                                left: `${verObj.sigPosition?.x ?? 65}%`,
                                                top: `${verObj.sigPosition?.y ?? 75}%`,
                                                width: `${verObj.sigSize?.width ?? 120}px`,
                                                height: `${verObj.sigSize?.height ?? 60}px`,
                                                transform: 'translate(-50%, -50%)',
                                              }}
                                              className="absolute pointer-events-none select-none z-[43] flex flex-col items-center justify-center"
                                            >
                                              <img 
                                                src={displaySigUrl} 
                                                className="w-full h-full object-contain mix-blend-multiply"
                                                alt={`Signature V${verObj.version}`}
                                                referrerPolicy="no-referrer"
                                              />
                                            </div>
                                          )}
 
                                          {/* Historic Stamp Layer (Forces stampUrl from database) */}
                                          {hasVerStamp && (
                                            <div 
                                              style={{
                                                position: 'absolute',
                                                left: `${verObj.stampPosition?.x ?? 25}%`,
                                                top: `${verObj.stampPosition?.y ?? 75}%`,
                                                width: `${verObj.stampSize?.width ?? 80}px`,
                                                height: `${verObj.stampSize?.height ?? 80}px`,
                                                transform: 'translate(-50%, -50%)',
                                              }}
                                              className="absolute pointer-events-none select-none z-[43] flex flex-col items-center justify-center"
                                            >
                                              <img 
                                                src={displayStampUrl} 
                                                className="w-full h-full object-contain mix-blend-multiply" 
                                                alt={`Stamp V${verObj.version}`}
                                                referrerPolicy="no-referrer"
                                              />
                                            </div>
                                          )}
 
                                          {/* Historic Annotation Layer */}
                                          {hasVerAnnot && (
                                            <div 
                                              style={{
                                                position: 'absolute',
                                                left: `${verObj.annotPosition?.x ?? 45}%`,
                                                top: `${verObj.annotPosition?.y ?? 35}%`,
                                                width: `${verObj.annotSize?.width ?? 180}px`,
                                                height: `${verObj.annotSize?.height ?? 75}px`,
                                                transform: 'translate(-50%, -50%)',
                                              }}
                                              className="absolute pointer-events-none select-none bg-transparent p-2 flex flex-col justify-between z-[43]"
                                            >
                                              <div 
                                                style={{
                                                  fontSize: `${verObj.annotFontSize || 10}px`,
                                                  color: verObj.annotColor || '#1A5276'
                                                }}
                                                className="font-black font-mono break-words uppercase tracking-wider max-h-full overflow-hidden"
                                              >
                                                {verObj.annotation}
                                              </div>
                                            </div>
                                          )}
                                        </React.Fragment>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="flex justify-between items-center text-[10px] text-gray-300 font-bold uppercase tracking-widest pt-2 border-t border-white/10">
                          <span>Auteur: {selectedDossier.createdBy?.displayName}</span>
                          <span>Matricule: {selectedDossier.createdBy?.matricule}</span>
                        </div>
                      </div>

                      {/* Version history list */}
                      <div className="bg-white p-6 rounded-3xl border border-gray-100 flex flex-col gap-3">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          Chronologie des rééditions (Versions)
                        </p>

                        <div className="space-y-3 max-h-[14rem] overflow-y-auto custom-scrollbar pr-2">
                          {(selectedDossier.versions || []).map((ver) => (
                            <div 
                              key={ver.version} 
                              onClick={() => setSelectedVersionNum(ver.version)}
                              className={`p-3.5 rounded-2xl border transition-all flex flex-col gap-2 cursor-pointer ${
                                selectedVersionNum === ver.version 
                                  ? 'bg-[#2C3E50]/5 border-[#2C3E50]/20 shadow-inner' 
                                  : 'bg-gray-50/50 border-gray-100 hover:border-gray-200 hover:bg-gray-100/30'
                              }`}
                            >
                              <div className="flex justify-between items-center">
                                <span className="bg-[#2C3E50]/10 text-[#2C3E50] text-[9.5px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                                  Version V{ver.version}
                                </span>
                                <span className="text-[9px] text-gray-400 font-bold">{new Date(ver.createdAt).toLocaleString()}</span>
                              </div>
                              <p className="text-xs text-gray-700 italic">
                                "{ver.annotation}"
                              </p>
                              <div className="flex items-center justify-between border-t border-gray-100 pt-2 mt-1">
                                <div className="flex items-center gap-1 text-[10px] text-[#2C3E50] font-bold">
                                  <span>Par: {ver.createdByName}</span>
                                  <span className="text-gray-300">•</span>
                                  <span>{ver.createdByRole || 'DGI'}</span>
                                  {ver.hasSignature && <span className="text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded text-[8px] uppercase font-black tracking-widest ml-1">Signé</span>}
                                  {ver.hasStamp && <span className="text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[8px] uppercase font-black tracking-widest ml-1">Sceau DGI</span>}
                                </div>
                                
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadDossier(ver.version);
                                  }}
                                  className="flex items-center gap-1 bg-[#2C3E50] hover:bg-[#34495E] text-[#FAFCFF] px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-sm border border-transparent hover:scale-105"
                                >
                                  Télécharger
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Right panel: Digital Annotation and Signature layout */}
                    <div className={`${studioZoomMode === 'studio' ? 'lg:col-span-4' : ''} flex flex-col gap-6`}>
                      
                      {['Annulé', 'Annulation en attente de confirmation'].includes(selectedDossier.status || '') ? (
                        <>
                          {/* If status is 'Annulé' */}
                          {selectedDossier.status === 'Annulé' && (
                            <div className="bg-red-50 border-2 border-red-200 p-6 rounded-3xl flex flex-col gap-4 text-center items-center shadow-sm">
                              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600 font-extrabold text-xl animate-pulse">⚠️</div>
                              <h3 className="text-red-905 font-black uppercase text-xs tracking-wider">Processus Définitivement Annulé</h3>
                              <p className="text-[10px] text-red-750 font-bold leading-relaxed">
                                Ce dossier a été archivé sous statut d'annulation irréversible par décision du Secrétariat Général et validation du Chef de Centre. Toutes les modifications courantes, l'apposition de calques, d'annotations ou les signatures sont désactivées pour protéger l'inviolabilité légale du dossier.
                              </p>
                            </div>
                          )}

                          {/* If status is 'Annulation en attente de confirmation' */}
                          {selectedDossier.status === 'Annulation en attente de confirmation' && (
                            <div className="bg-rose-50 border-2 border-rose-200 p-6 rounded-3xl flex flex-col gap-4 text-center items-center shadow-md">
                              <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 font-extrabold text-xl animate-bounce">⏳</div>
                              <h3 className="text-rose-950 font-black uppercase text-xs tracking-wider">Validation d'Annulation</h3>
                              
                              {isChefDeCentre(user) ? (
                                <div className="flex flex-col gap-2 w-full mt-1">
                                  <p className="text-[10.5px] text-rose-800 font-black leading-relaxed mb-2">
                                    Une procédure d'annulation définitive a été lancée par le Secrétariat. En qualité de Chef de Centre, veuillez arbitrer la légitimité de cette requête :
                                  </p>
                                  <div className="flex flex-col gap-2 w-full">
                                    <button 
                                      onClick={handleConfirmCancellation}
                                      className="w-full bg-red-600 hover:bg-red-700 text-white font-black uppercase tracking-widest text-[9px] py-3 rounded-2xl shadow transition-all cursor-pointer"
                                    >
                                      ✓ Confirmer l'Annulation
                                    </button>
                                    <button 
                                      onClick={handleRejectCancellation}
                                      className="w-full bg-gray-200 hover:bg-gray-300 text-gray-750 font-black uppercase tracking-widest text-[9px] py-3 rounded-2xl transition-all cursor-pointer"
                                    >
                                      ✕ Rejeter et Réactiver
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-[10px] text-rose-700 font-bold leading-relaxed">
                                  Une demande d'annulation définitive initiée par le Secrétariat Général est en attente d'approbation et de validation par le Chef de Centre. Toutes les modifications ou annotations de signature sont momentanément gelées.
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {isTransferReadOnly ? (
                            <div className="bg-amber-50/70 border border-amber-200 p-6 rounded-[2.5rem] flex flex-col gap-4 text-center items-center shadow-lg animate-in fade-in zoom-in duration-300">
                              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 font-extrabold text-xl animate-pulse">🔒</div>
                              <h3 className="text-amber-900 font-black uppercase text-xs tracking-wider">Dossier en lecture seule</h3>
                              <p className="text-[10px] text-amber-850 font-semibold leading-relaxed">
                                Dès qu'un dossier est transféré (statut 'En attente' ou envoyé à un autre agent), toute modification, annotation, signature manuscrite ou apposition de sceau est verrouillée pour l'expéditeur afin de préserver l'intégrité légale du document.
                              </p>
                              {selectedDossier.activePerimetre && (
                                <p className="text-[9.5px] font-black uppercase tracking-wider text-[#2C3E50]/75 bg-white border border-amber-200/50 px-4 py-2 rounded-2xl shadow-inner inline-flex items-center gap-1.5">
                                  <span>📍 Localisation active :</span>
                                  <span className="text-amber-700">{selectedDossier.activePerimetre === 'secretariat' ? 'Secrétariat Général' : selectedDossier.activePerimetre === 'gestionnaire' ? 'Gestionnaires' : selectedDossier.activePerimetre === 'admin_bureau' ? 'Chef de Bureau' : selectedDossier.activePerimetre}</span>
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="bg-[#FAFCFF] p-6 rounded-3xl border border-dashed border-slate-300 flex flex-col gap-4">
                              <div>
                                <h3 className="text-sm font-black text-[#2C3E50] uppercase tracking-wider flex items-center gap-2">
                                  <Stamp size={16} /> Annotation & Apposition de Sceau
                                </h3>
                                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
                                  Générer une nouvelle version certifiée du dossier
                                </p>
                              </div>

                              {/* Annotation text */}
                              <div className="flex flex-col gap-1.5">
                                <div className="flex justify-between items-center">
                                  <label className="text-[10px] font-black text-[#2C3E50] uppercase tracking-widest">
                                    Annotation de validation ou rectificative :
                                  </label>
                                  
                                  {/* Dynamic Text Size Selector */}
                                  <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Taille du texte :</span>
                                    <input 
                                      type="range" 
                                      min={10} 
                                      max={36} 
                                      value={annotationFontSize}
                                      onChange={(e) => setAnnotationFontSize(Number(e.target.value))}
                                      className="w-16 h-1 bg-slate-300 rounded-lg appearance-none cursor-pointer accent-[#2C3E50]"
                                    />
                                    <span className="text-[10px] font-bold font-mono text-[#2C3E50] min-w-[24px] text-right">{annotationFontSize}px</span>
                                  </div>
                                </div>
                                <textarea
                                  rows={3}
                                  placeholder="Saisissez vos instructions, commentaires légaux ou avis de visa..."
                                  value={annotationText}
                                  onChange={(e) => setAnnotationText(e.target.value)}
                                  className="bg-white border border-gray-200 p-3 rounded-2xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#34495E]"
                                />

                                {/* Annotation Color Selector */}
                                {annotationText.trim() !== '' && (
                                  <div className="flex flex-col gap-1.5 bg-slate-50/50 p-2.5 rounded-2xl border border-slate-100">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[8.5px] font-black text-[#2C3E50] uppercase tracking-widest">Couleur :</span>
                                      <span className="text-[8px] font-mono text-gray-400 font-extrabold">
                                        {annotationColor === '#002f6c' ? 'BLEU' :
                                         annotationColor === '#ff0906' ? 'ROUGE' :
                                         annotationColor === '#000000' ? 'NOIR' : 'BLANC'}
                                      </span>
                                    </div>
                                    <div className="flex gap-1.5">
                                      {[
                                        { hex: '#002f6c', label: 'Bleu', bg: 'bg-[#002f6c]', text: 'text-white' },
                                        { hex: '#ff0906', label: 'Rouge', bg: 'bg-[#ff0906]', text: 'text-white' },
                                        { hex: '#000000', label: 'Noir', bg: 'bg-black', text: 'text-white' },
                                        { hex: '#ffffff', label: 'Blanc', bg: 'bg-white', text: 'text-slate-800', border: 'border-gray-200' }
                                      ].map((color) => {
                                        const isActive = annotationColor === color.hex;
                                        return (
                                          <button
                                            key={color.hex}
                                            type="button"
                                            onClick={() => setAnnotationColor(color.hex)}
                                            className={`flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-xl text-[8.5px] font-black uppercase tracking-wider cursor-pointer border-2 transition-all ${
                                              isActive 
                                                ? 'scale-105 border-teal-500 shadow-sm' 
                                                : 'border-transparent opacity-80 hover:opacity-100 hover:scale-[1.02]'
                                            } ${color.bg} ${color.text} ${color.border || ''}`}
                                          >
                                            {isActive && <span className="text-[7px]">●</span>}
                                            {color.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Visual choices for Signatures / Stamps */}
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  onClick={() => {
                                    if (!includeSignature && (!user || !user.signatureUrl)) {
                                      setUploadPopupType('signature');
                                    } else {
                                      setIncludeSignature(!includeSignature);
                                    }
                                  }}
                                  className={`p-3.5 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                                    includeSignature 
                                      ? 'bg-teal-50 border-teal-200 text-teal-700 font-extrabold' 
                                      : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                                  }`}
                                >
                                  <UserCircle size={20} />
                                  <span className="text-[9.5px] font-black uppercase tracking-wider">Inclure ma Signature</span>
                                </button>

                                {isUserSealAuthorized(user) && (
                                  <button
                                    onClick={() => {
                                      if (!includeStamp && (!user || !user.stampUrl)) {
                                        setUploadPopupType('stamp');
                                      } else {
                                        setIncludeStamp(!includeStamp);
                                      }
                                    }}
                                    className={`p-3.5 rounded-2xl border transition-all flex flex-col items-center justify-center gap-1.5 cursor-pointer ${
                                      includeStamp 
                                        ? 'bg-blue-50 border-blue-200 text-blue-700 font-extrabold' 
                                        : 'bg-white border-gray-100 text-gray-400 hover:border-gray-200'
                                    }`}
                                  >
                                    <Shield size={20} />
                                    <span className="text-[9.5px] font-black uppercase tracking-wider">Inclure le Sceau DGI</span>
                                  </button>
                                )}
                              </div>

                              {/* Visual Signature preview */}
                              {(includeSignature || includeStamp) && (
                                <div className="bg-white border border-gray-100 p-4 rounded-2xl flex flex-col gap-2 text-center relative items-center justify-center">
                                  <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest absolute top-2">Aperçu du calque appliqué (détouré sans fond)</span>
                                  <div className="pt-4 flex gap-4 items-center justify-center">
                                    {includeSignature && (
                                      <div className="border border-dashed border-teal-200 px-3 py-1.5 rounded-xl text-teal-600 bg-teal-50/25">
                                        <p className="text-[8px] font-mono uppercase">Signature de :</p>
                                        <p className="font-serif italic text-xs font-bold">{user.displayName}</p>
                                      </div>
                                    )}
                                    {includeStamp && (
                                      <div className="border border-dashed border-blue-200 px-3 py-1.5 rounded-xl text-blue-600 bg-blue-50/25">
                                        <p className="text-[8px] font-bold uppercase tracking-widest">MINISTÈRE DES FINANCES</p>
                                        <p className="text-[9px] font-black uppercase tracking-widest text-[#2C3E50]">● DIRECTION DES IMPOTS ●</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Multi-page configuration panel */}
                              {pdfPagesCount > 1 && (includeSignature || includeStamp || annotationText.trim() !== '') && (
                                <div className="bg-slate-50 border border-slate-150 p-3.5 rounded-2xl flex flex-col gap-2">
                                  <p className="text-[9px] font-black text-[#2C3E50] uppercase tracking-widest border-b border-slate-200/60 pb-1 flex items-center justify-between">
                                    <span>Config Multi-pages :</span>
                                    <span className="text-[8.5px] font-mono text-zinc-400">{pdfPagesCount} pages</span>
                                  </p>
                                  
                                  {includeStamp && (
                                    <label className="flex items-center gap-2 text-[10px] text-[#2C3E50] font-bold cursor-pointer select-none">
                                      <input 
                                        type="checkbox" 
                                        checked={applyStampAllPages} 
                                        onChange={(e) => setApplyStampAllPages(e.target.checked)}
                                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                                      />
                                      <span>Appliquer Sceau sur TOUTES les pages</span>
                                    </label>
                                  )}

                                  {includeSignature && (
                                    <label className="flex items-center gap-2 text-[10px] text-[#2C3E50] font-bold cursor-pointer select-none">
                                      <input 
                                        type="checkbox" 
                                        checked={applySigAllPages} 
                                        onChange={(e) => setApplySigAllPages(e.target.checked)}
                                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                                      />
                                      <span>Appliquer Signature sur TOUTES les pages</span>
                                    </label>
                                  )}

                                  {annotationText.trim() !== '' && (
                                    <label className="flex items-center gap-2 text-[10px] text-[#2C3E50] font-bold cursor-pointer select-none">
                                      <input 
                                        type="checkbox" 
                                        checked={applyAnnotAllPages} 
                                        onChange={(e) => setApplyAnnotAllPages(e.target.checked)}
                                        className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
                                      />
                                      <span>Appliquer Annotation sur TOUTES les pages</span>
                                    </label>
                                  )}
                                </div>
                              )}

                              <button
                                onClick={handleAddAnnotationSignature}
                                className="bg-[#2C3E50] text-[#FAFCFF] hover:bg-[#34495E] py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-md transition-all cursor-pointer"
                              >
                                Enregistrer la version V{(selectedDossier.versions?.length || 1) + 1}
                              </button>

                              {(includeSignature || includeStamp || annotationText.trim() !== '') && (
                                <button
                                  onClick={handleClearCurrentPose}
                                  className="bg-gray-100 hover:bg-gray-200 text-gray-750 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer border border-gray-300 flex items-center justify-center gap-1.5"
                                >
                                  🔄 Effacer mes modifications en cours
                                </button>
                              )}

                              {canResetLatestVersion() && (
                                <div className="bg-amber-50/70 border border-amber-200/80 p-3.5 rounded-2xl flex flex-col gap-1.5 mt-2 transition-all">
                                  <p className="text-[9px] text-amber-800 font-extrabold uppercase tracking-wide leading-relaxed flex items-center gap-1">
                                    <span>🔄 Droit de recommencer activé</span>
                                  </p>
                                  <p className="text-[8.5px] text-amber-700 font-semibold leading-relaxed">
                                    Vous êtes l'auteur de la version courante V{selectedDossier.versions?.length || 1}. Tant que le dossier n'a pas fait l'objet d'un transfert, vous pouvez purger vos calques appliqués et recommencer d'un seul clic.
                                  </p>
                                  <button
                                    onClick={handleResetLatestVersion}
                                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-black uppercase text-[8.5px] tracking-wider py-2 rounded-xl transition-all shadow-sm cursor-pointer"
                                  >
                                    Réinitialiser et Recommencer
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Taxpayer linking controls */}
                      <div className="bg-white p-6 rounded-3xl border border-gray-100 flex flex-col gap-4">
                        <div>
                          <h3 className="text-xs font-black text-[#2C3E50] uppercase tracking-wider">
                            Liaison & Clôture de discussion Contribuable
                          </h3>
                        </div>

                        {selectedDossier.linkedConversationId ? (
                          (() => {
                            const activeConv = conversations.find(c => c.id === selectedDossier.linkedConversationId);
                            return (
                              <div className="bg-teal-50/20 p-4 rounded-2xl border border-teal-100 flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-black text-teal-800 uppercase tracking-wider">Dossier lié à la discussion active</span>
                                  <button
                                    onClick={handleUnlinkDiscussion}
                                    className="text-red-500 font-bold hover:text-red-700 text-[9px] uppercase cursor-pointer"
                                  >
                                    Retirer
                                  </button>
                                </div>
                                <div className="text-xs text-[#2C3E50] font-semibold mt-1">
                                  {activeConv ? (
                                    <>
                                      <p className="font-extrabold">{activeConv.contributorName || 'Dossier Contribuable'}</p>
                                      <p className="text-gray-500 font-medium italic mt-0.5">Sujet: {activeConv.subject}</p>
                                    </>
                                  ) : (
                                    <p className="font-extrabold text-amber-600">ID conversation rattachée: #{typeof selectedDossier.linkedConversationId === 'string' ? selectedDossier.linkedConversationId.slice(0, 8).toUpperCase() : String(selectedDossier.linkedConversationId || '').slice(0, 8).toUpperCase()}</p>
                                  )}
                                </div>
                              </div>
                            );
                          })()
                        ) : (
                          <div className="flex flex-col gap-3">
                            <input
                              type="text"
                              placeholder="Rechercher conversation de contribuable..."
                              value={taxpayerSearch}
                              onChange={(e) => setTaxpayerSearch(e.target.value)}
                              className="w-full px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-semibold"
                            />

                            <div className="max-h-28 overflow-y-auto custom-scrollbar border border-gray-100 rounded-2xl p-1 bg-white flex flex-col gap-1">
                              {conversations
                                .filter(c => {
                                  const text = taxpayerSearch.toLowerCase();
                                  return (
                                    (c.contributorName?.toLowerCase() || '').includes(text) ||
                                    (c.subject?.toLowerCase() || '').includes(text)
                                  );
                                })
                                .map(c => (
                                  <button
                                    key={c.id}
                                    onClick={() => handleLinkDiscussion(c.id)}
                                    className="w-full text-left p-2 hover:bg-gray-50 rounded-xl text-[10.5px] font-bold text-gray-800 transition-all flex items-center justify-between cursor-pointer"
                                  >
                                    <span className="truncate">{c.contributorName || 'Contribuable'} (Sujet: {c.subject})</span>
                                    <ChevronRight size={12} className="text-gray-400" />
                                  </button>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* Chef Exception Direct attribution list */}
                        {['admin_bureau', 'superviseur', 'superviseur_senior'].includes(user.perimetre || '') && (
                          <div className="border-t border-gray-100 pt-4 flex flex-col gap-2">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Commission Exceptionnelle (Attribution)</p>
                            
                            {selectedDossier?.assignedAgentId ? (
                              <div className="flex flex-col gap-1.5 bg-red-50/50 p-3 rounded-2xl border border-red-100 text-xs font-bold text-[#2C3E50]">
                                <div className="flex items-center justify-between">
                                  <span className="text-[#2C3E50]/90">Attribué à : <b className="text-[#2C3E50] font-black">{selectedDossier.assignedAgentName}</b></span>
                                  <button 
                                    onClick={() => handleAssignDossier('')}
                                    className="px-2.5 py-1 bg-white hover:bg-red-50 text-red-650 border border-red-200 rounded-xl font-black text-[9px] uppercase cursor-pointer shadow-xs transition-colors"
                                    title="Annuler l'attribution du dossier (Droit à l'erreur)"
                                  >
                                    ↩️ Annuler attribution
                                  </button>
                                </div>
                                <p className="text-[8.5px] text-gray-500 font-semibold uppercase tracking-wide">
                                  Droit à l'erreur : Vous pouvez annuler et réattribuer ce dossier libre à tout moment.
                                </p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                
                                {/* Routage automatique par Contribuable */}
                                <div className="flex flex-col gap-1.5 bg-[#2C3E50]/5 p-3 rounded-xl border border-[#2C3E50]/10">
                                  <label className="text-[9.5px] font-black text-[#2C3E50] uppercase tracking-wider flex items-center gap-1.5">
                                    🔍 Routage automatique par Contribuable
                                  </label>
                                  <input 
                                    type="text"
                                    placeholder="Rechercher par Contribuable ou Entreprise..."
                                    value={taxpayerSearchQuery}
                                    onChange={(e) => setTaxpayerSearchQuery(e.target.value)}
                                    className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2C3E50]"
                                  />
                                  
                                  {taxpayerSearchQuery.trim() && (
                                    <div className="flex flex-col gap-1.5 mt-2 max-h-36 overflow-y-auto bg-white p-2 rounded-xl border border-gray-100 shadow-inner">
                                      {(() => {
                                        const queryLower = taxpayerSearchQuery.toLowerCase();
                                        const filteredConvs = conversations.filter(c => 
                                          (c.contributorName || '').toLowerCase().includes(queryLower) ||
                                          (c.companyName || '').toLowerCase().includes(queryLower)
                                        );
                                        
                                        if (filteredConvs.length === 0) {
                                          return <p className="text-[9px] text-gray-400 font-bold uppercase text-center py-2">Aucun contribuable trouvé</p>;
                                        }
                                        
                                        return filteredConvs.map((c) => {
                                          const gId = c.assignedAgentId || c.agentId;
                                          const gName = c.assignedAgentName || (gId ? staffUsers.find(u => u.uid === gId)?.displayName : null) || 'Gestionnaire';
                                          
                                          return (
                                            <div key={c.id} className="flex flex-col gap-1 p-2 rounded-lg bg-gray-50/70 border border-gray-100 text-[10px]">
                                              <div className="flex justify-between items-center bg-white p-1 rounded-md border border-gray-100 mb-0.5">
                                                <span className="font-extrabold text-gray-800 truncate max-w-[12rem]">{c.contributorName || c.companyName || 'Contribuable'}</span>
                                                <span className="text-[8px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded-md font-bold truncate max-w-[8rem] uppercase">
                                                  {c.taxNumber || 'NIU'}
                                                </span>
                                              </div>
                                              <div className="flex justify-between items-center gap-2 mt-1">
                                                <span className="text-[9px] font-medium text-gray-500">
                                                  Gestionnaire : <strong className="text-gray-700">{gName || 'Non désigné'}</strong>
                                                </span>
                                                {gId ? (
                                                  <button
                                                    onClick={() => {
                                                      handleAssignDossier(gId);
                                                      setTaxpayerSearchQuery('');
                                                    }}
                                                    className="px-2 py-0.5 bg-[#2C3E50] text-[#FAFCFF] hover:bg-[#34495E] rounded-md font-black text-[8px] uppercase cursor-pointer transition-colors whitespace-nowrap"
                                                  >
                                                    ⚡ Pousser en 1 clic
                                                  </button>
                                                ) : (
                                                  <span className="text-[8px] text-amber-600 font-bold uppercase">Non affecté</span>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  )}
                                </div>

                                <div className="flex flex-col gap-1">
                                  <label className="text-[9px] text-gray-400">Ou attribuer manuellement à un agent :</label>
                                  <select 
                                    onChange={(e) => handleAssignDossier(e.target.value)}
                                    className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none"
                                    defaultValue=""
                                  >
                                    <option value="" disabled>Attribuer à un Gestionnaire...</option>
                                    {staffUsers
                                      .filter(u => (u.perimetre === 'gestionnaire' || u.role === 'gestionnaire' || u.role === 'agent') && u.isActive !== false)
                                      .map(u => (
                                        <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
                                      ))
                                    }
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                      </div>

                    </div>

                  </motion.div>
                )}

                {/* 2. CHAT COLLABORATIVE MESSAGING TAB */}
                {activeTab === 'chat' && (
                  <motion.div
                    key="chat_tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="h-full flex flex-col bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden"
                  >
                    
                    {/* Header showing that other agents see this */}
                    <div className="bg-gray-50/50 p-4 border-b border-gray-100 flex items-center gap-2">
                      <MessageSquare size={16} className="text-[#34495E]" />
                      <p className="text-[10px] font-black text-[#2C3E50] uppercase tracking-widest">
                        Fil d'instructions internes • {chatMessages.length} Messages
                      </p>
                    </div>

                    {/* Chat log messages */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                      {chatMessages.map((msg) => {
                        const isMe = msg.senderId === user?.uid;
                        return (
                          <div 
                            key={msg.id}
                            className={`flex flex-col max-w-[70%] gap-1 ${
                              isMe ? 'ml-auto items-end animate-fade-in' : 'items-start'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-0.5 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                              <span>{msg.senderName}</span>
                              <span>•</span>
                              <span>{msg.senderRole || 'Agent'}</span>
                              <button 
                                type="button"
                                onClick={() => setReplyToMsg(msg)}
                                className="text-teal-600 hover:text-teal-800 hover:underline ml-1 font-black cursor-pointer uppercase text-[8px] tracking-wider"
                              >
                                ↩ Répondre
                              </button>
                            </div>
                            
                            <div className={`p-4 rounded-3xl text-xs font-semibold leading-relaxed shadow-sm ${
                              isMe 
                                ? 'bg-[#2C3E50] text-[#FAFCFF] rounded-tr-none' 
                                : 'bg-[#FAFCFF] text-[#2C3E50] border border-gray-100 rounded-tl-none'
                            }`}>
                              {msg.replyTo && (
                                <div className={`p-2 rounded-xl mb-2 text-[10px] border-l-2 flex flex-col gap-0.5 text-left ${
                                  isMe 
                                    ? 'bg-white/10 border-teal-300 text-teal-100' 
                                    : 'bg-zinc-100 border-zinc-350 text-zinc-500'
                                }`}>
                                  <span className="font-extrabold uppercase tracking-wider text-[8px]">
                                    En réponse à {msg.replyTo.senderName} :
                                  </span>
                                  <span className="italic truncate max-w-xs">{msg.replyTo.text}</span>
                                </div>
                              )}
                              {msg.text}
                            </div>
                          </div>
                        );
                      })}

                      {chatMessages.length === 0 && (
                        <div className="text-center py-16 text-gray-400">
                          <MessageSquare size={32} className="mx-auto mb-2 text-gray-300 animate-pulse" />
                          <p className="text-xs font-black uppercase tracking-wider">Aucune note d'instruction rédigée</p>
                          <p className="text-[10px] text-gray-400 font-bold mt-1 max-w-xs mx-auto">Collaborez en direct, transmettez des notes d'études à d'autres agents.</p>
                        </div>
                      )}
                    </div>

                    {/* Reply to Preview block */}
                    {replyToMsg && (
                      <div className="px-4 py-2 bg-teal-50 border-t border-[#EBF2FA] flex justify-between items-center text-xs text-teal-950 font-bold animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-[8px] bg-teal-600 text-white font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider">Réponse</span>
                          <span className="text-gray-400 font-medium">à {replyToMsg.senderName} :</span>
                          <span className="italic truncate font-medium max-w-[20rem]">"{replyToMsg.text}"</span>
                        </div>
                        <button 
                          type="button"
                          onClick={() => setReplyToMsg(null)}
                          className="text-red-500 hover:text-red-700 font-black cursor-pointer px-2 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Send message form */}
                    <form onSubmit={handleSendInternalDossierMsg} className="p-4 border-t border-gray-100 flex items-center gap-2 bg-gray-50/20">
                      <input 
                        type="text"
                        placeholder="Rédiger une instruction de traitement..."
                        value={internalMsg}
                        onChange={(e) => setInternalMsg(e.target.value)}
                        className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-2xl text-xs font-semibold focus:outline-none"
                      />
                      <button 
                        type="submit"
                        className="bg-[#2C3E50] text-[#FAFCFF] hover:bg-[#34495E] p-2.5 rounded-full shadow-md transition-all cursor-pointer"
                      >
                        <Send size={14} />
                      </button>
                    </form>

                  </motion.div>
                )}

                {/* 3. INVIOLABLE TRANSIT LOGS TAB */}
                {activeTab === 'logs' && (
                  <motion.div
                    key="logs_tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="h-full bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4 overflow-hidden"
                  >
                    <div>
                      <h3 className="text-sm font-black text-[#2C3E50] uppercase tracking-wider">
                        Journal chronologique inviolable (Audit Trail)
                      </h3>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
                        Toutes les actions accomplies sur ce document d'État sont gravées cryptographiquement
                      </p>
                    </div>

                    {/* Timeline journal */}
                    <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 pb-6">
                      {(selectedDossier.historyLogs || []).map((log) => {
                        return (
                          <div key={log.id} className="relative pl-6 pb-2 border-l-2 border-gray-200 last:border-l-0">
                            
                            {/* Bullet icon representing different transition states */}
                            <div className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-[#2C3E50]" />
                            
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-[10px] font-black text-[#2C3E50] uppercase tracking-wider">
                                {log.action.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[9px] font-mono font-bold text-gray-400">
                                {new Date(log.timestamp).toLocaleString()}
                              </span>
                            </div>

                            <p className="text-xs text-gray-700 leading-relaxed font-semibold">
                              {log.description}
                            </p>

                            <div className="text-[9.5px] font-black text-[#34495E]/80 uppercase tracking-widest mt-1">
                              Auteur: {log.authorName} | {log.authorRole}
                            </div>
                          </div>
                        );
                      })}

                      {(selectedDossier.historyLogs || []).length === 0 && (
                        <p className="text-center text-gray-400 text-xs py-8">Aucune trace de journal n'a été insérée.</p>
                      )}
                    </div>

                  </motion.div>
                )}

              </AnimatePresence>
            </div>

          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-gray-400">
            <FolderGit size={64} className="text-[#34495E]/20 mb-4 animate-pulse" />
            <h2 className="text-sm font-black text-[#2C3E50] uppercase italic tracking-[0.05em]">Traitement des Dossiers DGI</h2>
            <p className="text-xs text-gray-400 uppercase mt-2 max-w-sm font-semibold">
              Sélectionnez un dossier à gauche ou créez-en un nouveau pour suivre l'historique de transit et valider juridiquement les actes.
            </p>
          </div>
        )}
      </div>

      {/* CREATE NEW DOSSIER DIALOG (MODAL CONTAINER) */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 bg-[#2C3E50]/70 backdrop-blur-md z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <div>
                <h3 className="text-sm font-black text-[#2C3E50] uppercase tracking-wider">
                  Nouveau Dossier Interne
                </h3>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
                  Enregistrement d'un document administratif fiscal officiel
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Titre du document fiscal :</label>
                  <input
                    type="text"
                    placeholder="Ex: Déclaration TVA Avril 2026 - SARL Alpha"
                    value={newDossierName}
                    onChange={(e) => setNewDossierName(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-xl text-xs font-semibold text-[#2C3E50] focus:outline-none focus:ring-1 focus:ring-[#2C3E50]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Note d'accompagnement initiale :</label>
                  <textarea
                    rows={2}
                    placeholder="Saisissez les instructions initiales de routage..."
                    value={newDossierDesc}
                    onChange={(e) => setNewDossierDesc(e.target.value)}
                    className="p-3 border border-gray-200 rounded-xl text-xs font-semibold text-[#2C3E50] focus:outline-none focus:ring-1 focus:ring-[#2C3E50]"
                  />
                </div>

                {/* Method selector */}
                <div className="flex flex-col gap-2 pt-1">
                  <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Méthode d'importation du document :</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setImportMethod('upload');
                        stopCamera();
                      }}
                      className={`py-3 px-4 rounded-2xl border text-xs font-bold uppercase transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
                        importMethod === 'upload'
                          ? 'bg-[#2C3E50] text-[#FAFCFF] border-transparent shadow-md'
                          : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'
                      }`}
                    >
                      <Paperclip size={16} />
                      <span className="text-[9px] tracking-wider">Téléverser fichier</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setImportMethod('scanner');
                      }}
                      className={`py-3 px-4 rounded-2xl border text-xs font-bold uppercase transition-all flex flex-col items-center justify-center gap-1 cursor-pointer ${
                        importMethod === 'scanner'
                          ? 'bg-[#2C3E50] text-[#FAFCFF] border-transparent shadow-md'
                          : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'
                      }`}
                    >
                      <Camera size={16} />
                      <span className="text-[9px] tracking-wider">Scanner Galerie</span>
                    </button>
                  </div>
                </div>

                {/* Import method panels */}
                {importMethod === 'upload' && (
                  <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-100 flex flex-col gap-2">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-wider">Section de téléversement</p>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp"
                      onChange={handleUploadFileChange}
                      className="block w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:tracking-wider file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200 cursor-pointer"
                    />
                    {uploadedFileName && (
                      <div className="text-[10px] text-[#2C3E50] font-bold mt-1 uppercase flex items-center gap-1">
                        <CheckCircle2 size={12} className="text-green-600" />
                        <span>Joint : {uploadedFileName} ({(uploadedFileSize / 1000).toFixed(1)} kB)</span>
                      </div>
                    )}
                  </div>
                )}

                {importMethod === 'scanner' && (
                  <div className="bg-gray-50/80 p-5 rounded-[24px] border border-gray-100 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-black text-[#2C3E50] uppercase tracking-wider">Scanner d'Appareil Unifié</p>
                        <p className="text-[7.5px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Captures de validation & pièces jointes fiscales</p>
                      </div>
                      {scannedFilesList.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setScannedFilesList([])}
                          className="text-[8.5px] font-black uppercase text-red-500 hover:text-red-700 transition-colors"
                        >
                          Tout effacer
                        </button>
                      )}
                    </div>

                    {/* Choose Precision Scanner with Cropping (Exiting component) */}
                    <button
                      type="button"
                      onClick={() => setShowScannerComponent(true)}
                      className="flex flex-col items-center justify-center p-6 bg-[#2C3E50]/5 hover:bg-[#2C3E50]/10 rounded-2xl border-2 border-dashed border-[#2C3E50]/30 hover:border-[#2C3E50] cursor-pointer transition-all gap-2 text-center group"
                    >
                      <div className="w-10 h-10 bg-teal-500 text-white rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform shadow-sm">
                        <Camera size={20} />
                      </div>
                      <div>
                        <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Numériseur de Précision (avec Rognage & Pivot)</p>
                        <p className="text-[8px] text-teal-600 font-black uppercase tracking-widest mt-0.5 animate-pulse">Système de découpe & d'alignement intelligent</p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 px-6">
                      <div className="h-px bg-gray-200 flex-grow"></div>
                      <span className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">Ou</span>
                      <div className="h-px bg-gray-200 flex-grow"></div>
                    </div>

                    {/* Hidden input for deep-integration native capture */}
                    <input 
                      type="file" 
                      accept="image/*,application/pdf" 
                      multiple 
                      capture="environment" 
                      onChange={handleNativeScanFiles}
                      className="hidden"
                      id="native-scanner-input"
                    />

                    {/* Trigger button */}
                    <label 
                      htmlFor="native-scanner-input"
                      className="flex flex-col items-center justify-center p-4 bg-white/60 hover:bg-white rounded-xl border border-dashed border-gray-200 hover:border-gray-400 cursor-pointer transition-all gap-1 text-center group"
                    >
                      <div>
                        <p className="text-[9.5px] font-black text-gray-500 hover:text-gray-700 uppercase tracking-wide">Prendre une photo rapide (Sans rognage)</p>
                        <p className="text-[7.5px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Importation d'image brute ou d'anciens PDFs</p>
                      </div>
                    </label>

                    {/* Vignettes/Grid of captured scans */}
                    {scannedFilesList.length > 0 && (
                      <div className="flex flex-col gap-3">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none">Pages capturées ({scannedFilesList.length}) :</p>
                        
                        <div className="grid grid-cols-3 gap-2 max-h-[140px] overflow-y-auto p-1 bg-white/50 rounded-xl border border-gray-100">
                          {scannedFilesList.map((file, idx) => (
                            <div key={file.id} className="relative group rounded-lg overflow-hidden border border-gray-200 bg-white p-1 flex flex-col items-center">
                              {file.base64.startsWith('data:application/pdf') ? (
                                <div className="w-full h-14 bg-red-50 rounded flex items-center justify-center text-red-500 text-[10px] font-black">
                                  PDF
                                </div>
                              ) : (
                                <img 
                                  src={file.base64} 
                                  alt={`page-${idx+1}`} 
                                  className="w-full h-14 object-cover rounded"
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              <span className="text-[7.5px] font-mono mt-1 text-gray-500 truncate w-full text-center">Page {idx+1}</span>
                              
                              <button
                                type="button"
                                onClick={() => setScannedFilesList(scannedFilesList.filter(f => f.id !== file.id))}
                                className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center text-[7px] cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Pipeline conditional UI */}
                        {scannedFilesList.length === 1 ? (
                          <div className="bg-white p-3 rounded-xl border border-gray-105 flex items-center justify-between">
                            <span className="text-[8.5px] font-black text-[#2C3E50] uppercase tracking-wider">Format d'exportation :</span>
                            <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
                              <button
                                type="button"
                                onClick={() => setSingleFileExportFormat('PDF')}
                                className={`px-2 py-1 rounded text-[8px] font-black uppercase tracking-wider transition-all ${
                                  singleFileExportFormat === 'PDF' 
                                    ? 'bg-[#2C3E50] text-white shadow-sm' 
                                    : 'text-gray-400 hover:text-gray-600'
                                }`}
                              >
                                PDF (Convertir)
                              </button>
                              <button
                                type="button"
                                onClick={() => setSingleFileExportFormat('JPEG')}
                                className={`px-2 py-1 rounded text-[8px] font-black uppercase tracking-wider transition-all ${
                                  singleFileExportFormat === 'JPEG' 
                                    ? 'bg-[#2C3E50] text-white shadow-sm' 
                                    : 'text-gray-400 hover:text-gray-600'
                                }`}
                              >
                                JPEG (Image)
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="bg-amber-50/70 border border-amber-200/50 p-2.5 rounded-xl text-amber-800 text-[8.5px] font-bold leading-normal flex items-start gap-1.5 shadow-sm">
                            <span>💡</span>
                            <div>
                              <p className="font-black uppercase tracking-wide">Compilation Multi-pages Active</p>
                              <p className="text-gray-500 leading-normal mt-0.5 font-bold uppercase tracking-wider">
                                Les {scannedFilesList.length} pages capturées seront concaténées dans l'ordre pour générer un document PDF unique.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-50 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setShowCreateModal(false);
                  }}
                  className="px-4 py-2 text-xs font-black uppercase text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleCreateDossier}
                  disabled={!newDossierName.trim() || !uploadedFileBase64}
                  className={`px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-md ${
                    newDossierName.trim() && uploadedFileBase64
                      ? 'bg-[#2C3E50] hover:bg-[#34495E] text-[#FAFCFF] cursor-pointer'
                      : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                  }`}
                >
                  Créer le Dossier
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DETAILED INTERACTIVE MULTI-PAGE & ROTATION PRECISION SCANNER COUPLING */}
      <AnimatePresence>
        {showScannerComponent && (
          <DocumentScanner
            onClose={() => setShowScannerComponent(false)}
            title="Numériseur de Dossiers de Traitement"
            onScanComplete={async (file) => {
              try {
                setStatusMsg("Traitement et cadrage du scan d'appareil...");
                const reader = new FileReader();
                const base64Promise = new Promise<string>((resolve) => {
                  reader.onload = (event) => {
                    resolve(event.target?.result as string);
                  };
                });
                reader.readAsDataURL(file);
                const base64Url = await base64Promise;

                setUploadedFileBase64(base64Url);
                setUploadedFileName(file.name);
                setUploadedFileExtension(file.name.split('.').pop()?.toLowerCase() || 'pdf');
                setUploadedFileSize(file.size);

                // Populate compiler list with a single compiled precise crop item so that saving hooks align perfectly
                setScannedFilesList([
                  {
                    id: Math.random().toString(36).substring(3, 9),
                    name: file.name,
                    base64: base64Url
                  }
                ]);

                setStatusMsg(`Fichier numérisé et recadré avec succès : ${file.name} (${Math.round(file.size / 1024)} kB)`);
                setShowScannerComponent(false);
              } catch (err: any) {
                console.error("Scanner onScanComplete conversion crash", err);
                setStatusMsg("Erreur de conversion de l'image de précision : " + err.message);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* SCANNER SPECIFIC COUPLING TO PNG/JPEG SIGNATURE & STAMP ASSET PREPARATION */}
      <AnimatePresence>
        {showScannerForAsset && (
          <DocumentScanner
            onClose={() => setShowScannerForAsset(null)}
            title={showScannerForAsset === 'signature' ? "Numériseur de Signature Manuscrite" : "Numériseur de Sceau / Cachet Actif"}
            forceSingleImageOnly={true}
            onScanComplete={async (file) => {
              try {
                setStatusMsg("Traitement du détourage intelligent de l'image numérisée...");
                handleLocalImageDeterage(file, showScannerForAsset);
                setShowScannerForAsset(null);
              } catch (err: any) {
                console.error("Scanner onScanComplete conversion crash for asset", err);
                setStatusMsg("Erreur lors de l'acquisition de la numérisation : " + err.message);
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* REVOLUTIONARY PROFILE SIGNATURE & STAMP BLOCK DIALOG (MANDATORY REGISTRAR COMPLIANCE RULE 5) */}
      <AnimatePresence>
        {uploadPopupType && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[120] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl border border-gray-100 flex flex-col gap-4 text-center items-center"
            >
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${uploadPopupType === 'signature' ? 'bg-teal-100 text-teal-600' : 'bg-blue-100 text-blue-600'}`}>
                <Stamp size={24} />
              </div>

              <div>
                <h3 className="text-sm font-black text-[#263238] uppercase tracking-wider">
                  {uploadPopupType === 'signature' ? 'Aucune signature configurée' : 'Aucun sceau configuré'}
                </h3>
                <p className="text-[11px] text-gray-500 font-semibold leading-relaxed mt-2 uppercase tracking-wide">
                  {uploadPopupType === 'signature' 
                    ? "Conformément aux protocoles de validation légitime DGI, veuillez importer votre signature manuscrite pour sceller ou valider ce document d'acte."
                    : "Conformément aux règles de légalisation, veuillez charger le sceau officiel du bureau pour l'apposer de façon absolue sur le dossier d'État."}
                </p>
              </div>

              <div className="w-full bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-300 flex flex-col gap-3">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-left">
                  {uploadPopupType === 'signature' ? "Option 1 : Importer votre signature (JPEG, PNG) :" : "Option 1 : Importer l'image du sceau (JPEG, PNG) :"}
                </p>
                
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && uploadPopupType) {
                      handleLocalImageDeterage(file, uploadPopupType);
                    }
                  }}
                  className={`block w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-[9.5px]/[normal] file:font-black file:uppercase file:tracking-wider cursor-pointer ${
                    uploadPopupType === 'signature'
                      ? 'file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100'
                      : 'file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100'
                  }`}
                />

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-gray-300/60"></div>
                  <span className="flex-shrink mx-3 text-[8.5px] font-black uppercase text-gray-405 tracking-wider">OU BIEN</span>
                  <div className="flex-grow border-t border-gray-300/60"></div>
                </div>

                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-left font-mono">
                  Option 2 : Numériseur / Scanner intégré :
                </p>

                <button
                  type="button"
                  onClick={() => {
                    setShowScannerForAsset(uploadPopupType);
                    setUploadPopupType(null);
                  }}
                  className={`w-full py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 border cursor-pointer hover:shadow-xs transition-all ${
                    uploadPopupType === 'signature'
                      ? 'bg-teal-50 border-teal-200 text-teal-750 hover:bg-teal-100'
                      : 'bg-blue-50 border-blue-200 text-blue-750 hover:bg-blue-100'
                  }`}
                >
                  <Camera size={13} />
                  Scanner l'image de l'appareil
                </button>

                <p className="text-[8.5px] text-slate-400 font-bold leading-normal text-left">
                  ⚖️ Le script de détourage intelligent isolera automatiquement le tracé de luminance pour effacer parfaitement tout fond gris ou blanc et rendre le calque 100% transparent.
                </p>
              </div>

              <div className="flex gap-2 w-full mt-2">
                <button
                  type="button"
                  onClick={() => setUploadPopupType(null)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Plus tard
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* COLLABORATIVE TRACEABILITY NOTE DIALOG (MANDATORY COMPLIANCE RULE 3 & 4) */}
      <AnimatePresence>
        {actionNotePromptOpen && pendingAction && (
          <div className="fixed inset-0 bg-[#2C3E50]/80 backdrop-blur-lg z-[150] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-white w-full max-w-md rounded-[32px] p-6 shadow-2xl border border-[#2C3E50]/15 flex flex-col gap-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#2C3E50]/10 rounded-2xl flex items-center justify-center text-[#2C3E50]">
                  <MessageSquare size={20} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-[#2C3E50] uppercase tracking-wider">
                    Note d'accompagnement obligatoire
                  </h3>
                  <p className="text-[9px] text-[#2C3E50] uppercase tracking-wider mt-0.5">
                    Protocole de tracé collaboratif de la DGI
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[9.5px] font-black text-gray-500 uppercase tracking-widest">
                  Veuillez spécifier l'instruction ou le motif de validation administrative :
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Ex: Dossier validé et scellé. Envoi au Secrétariat Général pour archivage légal..."
                  value={actionNoteText}
                  onChange={(e) => setActionNoteText(e.target.value)}
                  className="w-full bg-gray-50/50 p-3.5 border border-gray-200 rounded-2xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#2C3E50] focus:bg-white text-[#2C3E50]"
                />
              </div>

              {/* Nominative selection list for Secretariat routing to Bureau or Supervisor limits */}
              {pendingAction.type === 'transfer' && ['admin_bureau', 'superviseur', 'gestionnaire', 'superviseur_senior'].includes(pendingAction.value) && (
                <div className="flex flex-col gap-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <span className="text-[9.5px] font-black text-gray-500 uppercase tracking-widest leading-none flex items-center gap-1.5 mb-1">
                    👥 Sélectionner l'agent destinataire précis *
                  </span>
                  <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-1">
                    {getCandidatesForPerimeter(pendingAction.value).map((cand) => {
                      const isSelected = selectedTargetAgentId === cand.uid;
                      return (
                        <div
                          key={cand.uid}
                          onClick={() => setSelectedTargetAgentId(cand.uid)}
                          className={`flex items-center justify-between p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-[#2C3E50] text-[#FAFCFF] border-slate-700 shadow-sm'
                              : 'bg-white text-gray-700 hover:bg-gray-100 border-gray-200'
                          }`}
                        >
                          <div className="flex flex-col">
                            <span className="font-extrabold">{cand.displayName || cand.email}</span>
                            <span className={`text-[8.5px] ${isSelected ? 'text-gray-300' : 'text-gray-400'} font-semibold uppercase tracking-wider`}>
                              {cand.poste || cand.perimetre || 'Agent DGI'}
                            </span>
                          </div>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSelected ? 'border-teal-400 bg-teal-500/20' : 'border-gray-300'}`}>
                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-teal-400" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {!selectedTargetAgentId && (
                    <p className="text-[8px] text-red-650 font-extrabold uppercase tracking-wide mt-1 animate-pulse">
                      ⚠️ Vous devez cochez précisément un destinataire pour finaliser le transfert.
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1 border-t border-gray-50">
                <button
                  type="button"
                  onClick={() => {
                    setPendingAction(null);
                    setActionNotePromptOpen(false);
                  }}
                  className="px-4 py-2.5 text-[10px] font-black uppercase text-gray-400 hover:text-gray-600 cursor-pointer"
                >
                  Annuler l'action
                </button>
                <button
                  type="button"
                  onClick={executePendingActionWithNote}
                  disabled={!actionNoteText.trim() || (pendingAction.type === 'transfer' && ['admin_bureau', 'superviseur', 'gestionnaire', 'superviseur_senior'].includes(pendingAction.value) && !selectedTargetAgentId)}
                  className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all shadow-md ${
                    actionNoteText.trim() && (!(pendingAction.type === 'transfer' && ['admin_bureau', 'superviseur', 'gestionnaire', 'superviseur_senior'].includes(pendingAction.value)) || selectedTargetAgentId)
                      ? 'bg-[#2C3E50] hover:bg-[#34495E] text-[#FAFCFF] cursor-pointer'
                      : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'
                  }`}
                >
                  Enregistrer & Valider l'étape
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FULLSCREEN RESPONSIVE PREVIEWER (MANDATORY RULE 2) */}
      <AnimatePresence>
        {isFullscreenPreviewOpen && selectedDossier && (
          <div className="fixed inset-0 bg-zinc-950 z-[200] flex flex-col justify-between">
            {/* Top Toolbar */}
            <div className="bg-black/80 backdrop-blur-sm p-4 border-b border-zinc-800 flex items-center justify-between text-white flex-shrink-0 z-10 px-6">
              <div className="flex items-center gap-3">
                <FileText size={20} className="text-zinc-400" />
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-zinc-100">{selectedDossier.name}</h3>
                  <p className="text-[9px] text-zinc-400 uppercase tracking-widest font-mono mt-0.5">
                    {selectedVersionNum ? `VERSION ACTUELLE V${selectedVersionNum}` : 'Visualisation du document d\'origine'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDownloadDossier(selectedVersionNum || undefined)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white rounded-full px-4 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer"
                >
                  Télécharger
                </button>

                <button
                  type="button"
                  onClick={() => setIsFullscreenPreviewOpen(false)}
                  className="bg-white/10 hover:bg-white/20 text-white text-[10px] font-black uppercase tracking-wider px-4 py-1.5 rounded-full cursor-pointer transition-all border border-zinc-800"
                >
                  Fermer ✕
                </button>
              </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 flex items-center justify-center p-6 relative overflow-auto custom-scrollbar select-none bg-[#111113]">
              {(() => {
                if (!activeFileUrl) {
                  return (
                    <div className="flex flex-col items-center justify-center min-h-[40vh] text-zinc-400">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1A5276] mb-4" />
                      <p className="text-sm font-bold uppercase tracking-widest text-zinc-500">Chargement sécurisé...</p>
                    </div>
                  );
                }

                const isPdfUrl = activeFileUrl?.startsWith('data:application/pdf') || (activeFileUrl?.startsWith('blob:') && selectedDossier.extension?.toLowerCase() === 'pdf') || activeBlobUrl !== '';
                const isImage = activeFileUrl?.startsWith('data:image/') || activeFileUrl?.includes('unsplash.com') || (!isPdfUrl && ['png', 'jpg', 'jpeg', 'webp'].includes(selectedDossier.extension?.toLowerCase() || ''));
                const isPdf = isPdfUrl || selectedDossier.extension?.toLowerCase() === 'pdf';
                
                if (isImage) {
                  return (
                    <div className="relative max-w-full max-h-[85vh] p-2 bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 flex items-center justify-center shadow-2xl">
                      <img 
                        src={activeFileUrl} 
                        className="max-h-[80vh] max-w-full object-contain rounded-2xl select-none" 
                        alt="Visualisation Plein Écran"
                        referrerPolicy="no-referrer"
                      />
                      {/* Overlay seals & signatures */}
                      {(() => {
                        const limitVer = selectedVersionNum || (selectedDossier.versions?.length ? selectedDossier.versions[selectedDossier.versions.length - 1].version : 0);
                        const renderVersions = (selectedDossier.versions || []).filter(v => v.version <= limitVer);

                        return renderVersions.map((verObj) => {
                          const displaySigUrl = verObj.signatureUrl === 'SPLIT_DATA'
                            ? (loadedOverlays[verObj.version]?.signatureUrl || '')
                            : (verObj.signatureUrl || '');

                          const displayStampUrl = verObj.stampUrl === 'SPLIT_DATA'
                            ? (loadedOverlays[verObj.version]?.stampUrl || '')
                            : (verObj.stampUrl || '');

                          return (
                            <React.Fragment key={verObj.version}>
                              {/* Historic Signature Layer */}
                              {verObj.hasSignature && displaySigUrl && (
                                <div 
                                  style={{
                                    position: 'absolute',
                                    left: `${verObj.sigPosition?.x ?? 65}%`,
                                    top: `${verObj.sigPosition?.y ?? 75}%`,
                                    width: `${verObj.sigSize?.width ?? 120}px`,
                                    height: `${verObj.sigSize?.height ?? 60}px`,
                                    transform: 'translate(-50%, -50%)',
                                  }}
                                  className="absolute pointer-events-none select-none z-[40]"
                                >
                                  <img 
                                    src={displaySigUrl} 
                                    className="w-full h-full object-contain mix-blend-multiply" 
                                    alt={`Signature V${verObj.version}`}
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}

                              {/* Historic Stamp Layer */}
                              {verObj.hasStamp && displayStampUrl && (
                                <div 
                                  style={{
                                    position: 'absolute',
                                    left: `${verObj.stampPosition?.x ?? 25}%`,
                                    top: `${verObj.stampPosition?.y ?? 75}%`,
                                    width: `${verObj.stampSize?.width ?? 80}px`,
                                    height: `${verObj.stampSize?.height ?? 80}px`,
                                    transform: 'translate(-50%, -50%)',
                                  }}
                                  className="absolute pointer-events-none select-none z-[40]"
                                >
                                  <img 
                                    src={displayStampUrl} 
                                    className="w-full h-full object-contain mix-blend-multiply" 
                                    alt={`Stamp V${verObj.version}`}
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}

                              {/* Historic Annotation Layer */}
                              {verObj.annotation && verObj.annotPosition && (
                                <div 
                                  style={{
                                    position: 'absolute',
                                    left: `${verObj.annotPosition.x}%`,
                                    top: `${verObj.annotPosition.y}%`,
                                    width: `${verObj.annotSize?.width ?? 180}px`,
                                    height: `${verObj.annotSize?.height ?? 75}px`,
                                    transform: 'translate(-50%, -50%)',
                                    fontSize: `${verObj.annotFontSize || 10}px`
                                  }}
                                  className="absolute pointer-events-none select-none bg-transparent text-[#1A5276] p-2 leading-tight font-black font-mono break-words z-[40] uppercase tracking-wider"
                                >
                                  {verObj.annotation}
                                </div>
                              )}
                            </React.Fragment>
                          );
                        });
                      })()}
                    </div>
                  );
                } else if (isPdf) {
                  return (
                    <iframe 
                      src={activeBlobUrl || activeFileUrl}
                      className="w-full max-w-5xl h-[80vh] bg-white rounded-2xl shadow-2xl border border-zinc-800"
                      title="PDF Visualisation Plein Écran"
                    />
                  );
                } else {
                  return (
                    <div className="flex flex-col items-center justify-center bg-zinc-900 rounded-3xl p-12 text-zinc-400 border border-zinc-850">
                      <FileText className="text-zinc-600 mb-4" size={64} />
                      <p className="text-sm font-black uppercase tracking-widest text-zinc-100">{selectedDossier.name}</p>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-1">Format: .{(selectedDossier.extension || 'PDF').toUpperCase()}</p>
                    </div>
                  );
                }
              })()}
            </div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
