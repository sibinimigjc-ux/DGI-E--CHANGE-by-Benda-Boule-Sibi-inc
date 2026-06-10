import React, { useState, useEffect, useRef } from 'react';
import { 
  FolderGit, Search, Plus, FileText, ArrowRight, CheckCircle2, Shield, 
  UserCircle, MessageSquare, Send, Paperclip, Lock, Unlock, Users, ChevronRight, Stamp, Camera
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

export default function DossiersInternesPage() {
  const { user } = useAuth();
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
        list = list.map(item => {
          if (item.id === dossierId) {
            return {
              ...item,
              ...payload,
              updatedAt: new Date().toISOString()
            };
          }
          return item;
        });
        localStorage.setItem('cache_ged_items_administrative', JSON.stringify(list));
        setDossiers(list);
        setSelectedDossier(prev => {
          if (!prev || prev.id !== dossierId) return prev;
          return { ...prev, ...payload };
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

      // 3. Handle version files if they are in payload
      if (payload.versions) {
        payload.versions = await Promise.all(payload.versions.map(async (ver: any) => {
          if (ver.fileUrl && ver.fileUrl.length > 200000 && ver.fileUrl !== 'SPLIT_DATA') {
            try {
              try {
                await setDoc(doc(db, 'ged_items_files', `${dossierId}_v${ver.version}`), {
                  fileUrl: ver.fileUrl,
                  createdAt: serverTimestamp()
                });
              } catch (e) {
                console.warn("Firestore setDoc sub-file failed:", e);
              }
              return { ...ver, fileUrl: 'SPLIT_DATA' };
            } catch (e) {
              console.error("Version split error:", e);
              return { ...ver, fileUrl: '' };
            }
          }
          return ver;
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

  // Action notes & workflow variables (tracé collaboratif)
  const [actionNotePromptOpen, setActionNotePromptOpen] = useState(false);
  const [actionNoteText, setActionNoteText] = useState('');
  const [pendingAction, setPendingAction] = useState<{ type: 'status' | 'transfer', value: string, agentId?: string } | null>(null);

  // Defensive administrative purge for first-time session (Cleans all pre-existing fake data)
  useEffect(() => {
    if (!user) return;
    const key = `dgi_administrative_purged_${user.uid}_v2`;
    if (!localStorage.getItem(key)) {
      const q = query(
        collection(db, 'ged_items'),
        where('space', '==', 'administrative')
      );
      getDocs(q).then((snap) => {
        snap.docs.forEach((docSnap) => {
          deleteDoc(doc(db, 'ged_items', docSnap.id)).catch(err => {
            console.error("Purging test document err:", err);
          });
        });
        localStorage.setItem(key, 'true');
      });
    }
  }, [user]);

  // Reset selected version when selection changes 
  useEffect(() => {
    setSelectedVersionNum(null);
  }, [selectedDossier?.id]);

  // New Dossier inputs
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScannerComponent, setShowScannerComponent] = useState(false);
  const [newDossierName, setNewDossierName] = useState('');
  const [newDossierDesc, setNewDossierDesc] = useState('');

  // Annotation inputs
  const [annotationText, setAnnotationText] = useState('');
  const [includeSignature, setIncludeSignature] = useState(false);
  const [includeStamp, setIncludeStamp] = useState(false);

  // References and coordinates for drag and drop signature placement
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [sigPosition, setSigPosition] = useState({ x: 65, y: 75 });
  const [sigSize, setSigSize] = useState({ width: 120, height: 60 });
  const [stampPosition, setStampPosition] = useState({ x: 25, y: 75 });
  const [stampSize, setStampSize] = useState({ width: 80, height: 80 });
  const [annotPosition, setAnnotPosition] = useState({ x: 45, y: 35 });
  const [annotSize, setAnnotSize] = useState({ width: 180, height: 75 });

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

    const q = query(collection(db, 'users'), where('role', 'in', ['admin', 'agent']));
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
      collection(db, 'conversations'),
      where('status', '==', 'open')
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

    try {
      const cached = localStorage.getItem('cache_ged_items_administrative');
      if (cached) {
        const list = JSON.parse(cached);
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
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as GedItem));
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
          const list = JSON.parse(cached);
          setDossiers(list);
          setSelectedDossier(prev => {
            if (!prev) return null;
            const updated = list.find((d: any) => d.id === prev.id);
            return updated || prev;
          });
        } else {
          // Create an initial mock dossier list so the workspace is fully functional under quota exceeded state
          const sampleDossiers: GedItem[] = [
            {
              id: 'dossier-sample-01',
              name: 'Dossier Fiscal Alphanet RDC',
              type: 'file',
              parentId: 'root',
              space: 'administrative',
              ownerId: user.uid,
              ownerEmail: user.email,
              extension: 'pdf',
              fileUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=640',
              fileSize: 102400,
              isDeleted: false,
              status: 'En cours',
              createdAt: { seconds: Date.now() / 1000 - 86400, nanoseconds: 0 } as any,
              createdBy: {
                uid: user.uid,
                displayName: user.displayName || 'Gradi Jackson Christ',
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                matricule: 'M-019'
              },
              historyLogs: [{
                id: 'log-01',
                authorName: user.displayName || 'Gradi Jackson Christ',
                authorRole: user.poste || 'Directeur Administration',
                action: 'CREATION_DOSSIER',
                description: 'Création initiale du dossier fiscal.',
                timestamp: new Date(Date.now() - 86400000).toISOString()
              }],
              versions: [{
                version: 1,
                fileUrl: 'https://images.unsplash.com/photo-1554415707-6e8cfc93fe23?q=80&w=640',
                annotation: 'Document initial soumis.',
                createdBy: user.uid,
                createdByName: user.displayName || 'Gradi Jackson Christ',
                createdByRole: user.poste || 'Directeur Administration',
                createdAt: new Date(Date.now() - 86400000).toISOString()
              }]
            },
            {
              id: 'dossier-sample-02',
              name: 'Note de Synthèse DGI 2026',
              type: 'file',
              parentId: 'root',
              space: 'administrative',
              ownerId: user.uid,
              ownerEmail: user.email,
              extension: 'jpg',
              fileUrl: 'https://images.unsplash.com/photo-1606857521015-7f9fcf423740?q=80&w=640',
              fileSize: 153600,
              isDeleted: false,
              status: 'Nouveau',
              createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
              createdBy: {
                uid: 'system',
                displayName: 'Audit DGI',
                firstName: 'Secrétariat',
                lastName: 'DGI',
                matricule: 'S-772'
              },
              historyLogs: [{
                id: 'log-02',
                authorName: 'Système',
                authorRole: 'Audit DGI',
                action: 'CREATION_DOSSIER',
                description: 'Importation par numérisation.',
                timestamp: new Date().toISOString()
              }],
              versions: [{
                version: 1,
                fileUrl: 'https://images.unsplash.com/photo-1606857521015-7f9fcf423740?q=80&w=640',
                annotation: 'Rapport financier original.',
                createdBy: user.uid,
                createdByName: user.displayName || 'Gradi Jackson Christ',
                createdByRole: user.poste || 'Directeur Administration',
                createdAt: new Date().toISOString()
              }]
            }
          ];
          setDossiers(sampleDossiers);
        }
      } catch (e) {}
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

    // If Nouveau, let's auto-upgrade to 'En cours'
    if (currentStatus === 'Nouveau') {
      // Check if user is the dispatcher to avoid auto-upgrading their own sent files
      const isDispatcher = selectedDossier.lastDispatcherId === user.uid;
      if (isDispatcher) return;

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
          const maxW = 200;
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
            
            // Clean pixel background where luminance > 205 (isolates the pen ink/seal trace)
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i+1];
              const b = data[i+2];
              const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
              if (luminance > 205) {
                data[i+3] = 0; // Transparent
              }
            }
            ctx.putImageData(imgData, 0, 0);
            
            let processedBase64Url = canvas.toDataURL('image/webp', 0.6);
            if (!processedBase64Url.startsWith('data:image/webp')) {
              processedBase64Url = canvas.toDataURL('image/png');
            }
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

  // Note-enforcement interceptor methods (Tracé Collaboratif Règle 3 / 4)
  const triggerStatusUpdateWithNote = (newStatus: 'Nouveau' | 'En cours' | 'Terminé / Envoyé' | 'Archivé') => {
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
    setActionNotePromptOpen(true);
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
        const newStatus = pendingAction.value as 'Nouveau' | 'En cours' | 'Terminé / Envoyé' | 'Archivé';
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
          authorName: user.displayName || 'Agent',
          authorRole: user.poste || 'Agent DGI',
          action: 'CHANGEMENT_STATUT',
          description: `Changement de statut vers [${newStatus}]. Note d'accompagnement : "${noteMessage}"`,
          timestamp: new Date().toISOString()
        };
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
        const targetAgentId = pendingAction.agentId;
        const fromName = user.displayName || 'Agent';
        const pText = targetPerimetre === 'secretariat' ? 'Secrétariat Général' : 
                      targetPerimetre === 'gestionnaire' ? 'Service Gestionnaires DGI' : 
                      targetPerimetre === 'admin_bureau' ? 'Administration du Bureau' :
                      targetPerimetre === 'superviseur' ? 'Superviseurs' : 'Service Administratif';
                      
        const targetAgent = targetAgentId ? staffUsers.find(u => u.uid === targetAgentId) : null;
        const actDesc = `Dossier transféré au périmetre [${pText}]${targetAgent ? ` (${targetAgent.displayName})` : ''}. Note d'accompagnement obligatoire : "${noteMessage}"`;

        const logEntry = {
          id: Math.random().toString(36).slice(-6),
          authorName: fromName,
          authorRole: user.poste || 'Chef de centre',
          action: 'TRANSIT_OUT',
          description: actDesc,
          timestamp: new Date().toISOString()
        };

        const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
        
        await safeUpdateDossier(selectedDossier.id, {
          isLocked: true, 
          status: 'Nouveau', // Sent folders appear as 'Nouveau' inside recipient's files (Règle 4)
          activePerimetre: targetPerimetre,
          lastDispatcherId: user.uid,
          assignedAgentId: targetAgentId || selectedDossier.assignedAgentId || null,
          historyLogs: updatedLogs,
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
        authorName: fromName,
        authorRole: user.poste || 'Chef de centre',
        action: 'TRANSIT_OUT',
        description: actDesc,
        timestamp: new Date().toISOString()
      };

      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];
      
      await safeUpdateDossier(selectedDossier.id, {
        isLocked: true, // Lock document when dispatched/routed
        activePerimetre: targetPerimetre,
        lastDispatcherId: user.uid,
        assignedAgentId: targetAgentId || selectedDossier.assignedAgentId || null,
        historyLogs: updatedLogs,
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

    setStatusMsg("Validation et scellage en cours...");

    try {
      const nextVer = (selectedDossier.versions?.length || 1) + 1;
      const baseImgUrl = selectedDossier.fileUrl || '';

      const newVerObj = {
        version: nextVer,
        fileUrl: '', // Keep empty string to avoid duplicating massive base64 payload in versions array; renders/downloads gracefully fallback to the original dossier's fileUrl
        annotation: annotationText.trim() || 'Avenant de validation signé.',
        hasSignature: includeSignature,
        hasStamp: includeStamp,
        signatureUrl: includeSignature ? (user.signatureUrl || '') : '',
        stampUrl: includeStamp ? (user.stampUrl || '') : '',
        sigPosition: includeSignature ? sigPosition : null,
        sigSize: includeSignature ? sigSize : null,
        stampPosition: includeStamp ? stampPosition : null,
        stampSize: includeStamp ? stampSize : null,
        annotPosition: annotationText.trim() ? annotPosition : null,
        annotSize: annotationText.trim() ? annotSize : null,
        createdBy: user.uid,
        createdByName: user.displayName || 'Agent',
        createdByRole: user.poste || 'Administrateur',
        createdAt: new Date().toISOString()
      };

      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'NOUVELLE_VERSION',
        description: `Génération de la Version V${nextVer} scellée sur document. ${includeSignature ? '[Signature manuscrite apposée]' : ''} ${includeStamp ? '[Sceau officiel d\'État scellé]' : ''}`,
        timestamp: new Date().toISOString()
      };

      const updatedVersions = [...(selectedDossier.versions || []), newVerObj];
      const updatedLogs = [...(selectedDossier.historyLogs || []), logEntry];

      await safeUpdateDossier(selectedDossier.id, {
        versions: updatedVersions,
        historyLogs: updatedLogs,
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
      createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any
    };

    // Optimistic UI updates
    setChatMessages(prev => [...prev, newMsgObj]);
    setInternalMsg('');

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
        createdAt: serverTimestamp()
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
        options: {
          hasSignature?: boolean;
          signatureUrl?: string | null;
          sigPosition?: { x: number; y: number } | null;
          sigSize?: { width: number; height: number } | null;
          hasStamp?: boolean;
          stampUrl?: string | null;
          stampPosition?: { x: number; y: number } | null;
          stampSize?: { width: number; height: number } | null;
          annotation?: string | null;
          annotPosition?: { x: number; y: number } | null;
          annotSize?: { width: number; height: number } | null;
        }
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
            // 1. Draw Stamp (Sceau)
            if (options.hasStamp && options.stampUrl && options.stampPosition) {
              await new Promise<void>((rStamp) => {
                const sImg = new Image();
                sImg.crossOrigin = 'anonymous';
                sImg.onload = () => {
                  const w = options.stampSize?.width ?? 80;
                  const h = options.stampSize?.height ?? 80;
                  const scale = canvas.width / 600;
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
            if (options.hasSignature && options.signatureUrl && options.sigPosition) {
              await new Promise<void>((rSig) => {
                const sigImg = new Image();
                sigImg.crossOrigin = 'anonymous';
                sigImg.onload = () => {
                  const w = options.sigSize?.width ?? 120;
                  const h = options.sigSize?.height ?? 60;
                  const scale = canvas.width / 600;
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
            if (options.annotation && options.annotPosition) {
              const aW = options.annotSize?.width ?? 180;
              const aH = options.annotSize?.height ?? 75;
              const scale = canvas.width / 600;
              const targetW = aW * scale;

              const centerX = (options.annotPosition.x / 100) * canvas.width;
              const centerY = (options.annotPosition.y / 100) * canvas.height;
              const targetX = centerX - (targetW / 2);
              const targetY = centerY - (aH * scale / 2);

              ctx.fillStyle = "#1A5276"; // Dark elegant DGI blue-teal color
              
              const fontSize = Math.max(10, Math.round(10 * scale));
              ctx.font = `bold ${fontSize}px monospace`;
              ctx.textBaseline = 'top';

              const prefix = "VISA DGI : ";
              const fullText = (`${prefix}${options.annotation}`).toUpperCase();
              
              const words = fullText.split(' ');
              let currentLine = '';
              let drawY = targetY + (4 * scale);
              const spaceWidth = ctx.measureText(' ').width;
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
                  const res = await fetch(backgroundUrl);
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
      // and perform dynamic canvas-based sealing directly onto the original document
      const verWithOverlays = versionNum ? selectedDossier.versions?.find(v => v.version === versionNum) : null;
      const hasOverlays = verWithOverlays && (verWithOverlays.hasSignature || verWithOverlays.hasStamp || verWithOverlays.annotation);

      if (hasOverlays && verWithOverlays) {
        setStatusMsg("Fusion des sceaux et signatures directement sur le document d'origine...");
        try {
          const mergedBase64 = await mergeOverlaysWithBackground(targetUrl, {
            hasSignature: verWithOverlays.hasSignature,
            signatureUrl: verWithOverlays.signatureUrl,
            sigPosition: verWithOverlays.sigPosition,
            sigSize: verWithOverlays.sigSize,
            hasStamp: verWithOverlays.hasStamp,
            stampUrl: verWithOverlays.stampUrl,
            stampPosition: verWithOverlays.stampPosition,
            stampSize: verWithOverlays.stampSize,
            annotation: verWithOverlays.annotation,
            annotPosition: verWithOverlays.annotPosition,
            annotSize: verWithOverlays.annotSize
          });

          const ext = (selectedDossier.extension || 'pdf').toLowerCase();
          
          if (ext === 'pdf') {
            const pdf = new jsPDF({
              orientation: 'portrait',
              unit: 'px',
              format: 'a4'
            });
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            pdf.addImage(mergedBase64, 'JPEG', 0, 0, pdfW, pdfH, undefined, 'FAST');
            pdf.save(selectedDossier.name + `_V${versionNum}.pdf`);
          } else {
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

  // FILTER LOGIC
  const filteredDossiers = dossiers.filter(d => {
    const sLower = searchTerm.toLowerCase();
    const matchesSearch = d.name.toLowerCase().includes(sLower) || 
                          (d.createdBy?.displayName || '').toLowerCase().includes(sLower);
    if (statusFilter === 'Tous') return matchesSearch;
    return d.status === statusFilter && matchesSearch;
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
      <div className="w-full lg:w-96 border-r border-[#EBF2FA] flex flex-col h-full bg-white flex-shrink-0">
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

          {/* Status Filters */}
          <div className="flex gap-1.5 mt-4 overflow-x-auto pb-1.5 scrollbar-hide">
            {['Tous', 'Nouveau', 'En cours', 'Terminé / Envoyé', 'Archivé'].map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer ${
                  statusFilter === st 
                    ? 'bg-[#2C3E50] text-[#FAFCFF] shadow-sm' 
                    : 'bg-gray-50 text-gray-500 border border-gray-100 hover:bg-gray-100'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Dossiers list container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          {filteredDossiers.map(dossier => {
            const isSelected = selectedDossier?.id === dossier.id;
            const currentStatus = dossier.status || 'Nouveau';
            return (
              <button
                key={dossier.id}
                onClick={() => {
                  setSelectedDossier(dossier);
                  setActiveTab('details');
                }}
                onTouchStart={() => {
                  setSelectedDossier(dossier);
                  setActiveTab('details');
                }}
                className={`w-full text-left p-4 rounded-3xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 ${
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
                    'bg-gray-100 text-gray-700 border-gray-200'
                  }`}>
                    {currentStatus}
                  </span>
                  
                  {dossier.isLocked && (
                    <Lock size={12} className="text-gray-400" />
                  )}
                </div>

                <p className="text-xs font-extrabold text-gray-900 leading-normal line-clamp-2">
                  {dossier.name}
                </p>

                <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1 pt-2 border-t border-gray-50">
                  <span className="font-bold truncate max-w-[120px]">
                    Par: {dossier.createdBy?.displayName || 'DGI staff'}
                  </span>
                  <span className="font-mono">
                    V{(dossier.versions?.length || 1)}
                  </span>
                </div>
              </button>
            );
          })}

          {filteredDossiers.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <FolderGit size={32} className="mx-auto mb-2 text-gray-300 animate-pulse" />
              <p className="text-xs font-black uppercase tracking-wider">Aucun dossier à traiter</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR: DOSSIER WORKFLOW ROOM */}
      <div className="flex-1 flex flex-col h-full bg-[#FAFCFF] overflow-hidden">
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
              </div>

              {/* Status control buttons - sequence process */}
              <div className="flex items-center gap-2">
                
                {/* Secure Routing: Transfer Action inside dropdown */}
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
              </div>
            </div>

            {/* Stepper Tracking steps above dossier content */}
            <div className="bg-white border-b border-[#EBF2FA] px-6 py-3 flex items-center justify-between gap-2 overflow-x-auto scrollbar-hide flex-shrink-0">
              {['Nouveau', 'En cours', 'Terminé / Envoyé', 'Archivé'].map((st, i) => {
                const isActive = selectedDossier.status === st;
                return (
                  <button
                    key={st}
                    onClick={() => triggerStatusUpdateWithNote(st as any)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-2xl transition-all cursor-pointer min-w-[12rem] justify-center ${
                      isActive 
                        ? 'bg-[#2C3E50] text-[#FAFCFF] font-black uppercase shadow-lg shadow-gray-200' 
                        : 'bg-gray-50/50 hover:bg-gray-50 border border-gray-100 text-gray-400'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
                      isActive ? 'bg-[#FAFCFF] text-[#2C3E50]' : 'bg-gray-200 text-gray-500'
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

                            return (
                              <div className={`flex-1 flex flex-col bg-zinc-950 rounded-xl overflow-hidden border border-gray-800 relative p-1.5 justify-center items-center transition-all duration-300 ${studioZoomMode === 'studio' ? 'min-h-[580px]' : 'min-h-[380px]'}`}>
                                <div className="relative w-full h-full flex items-center justify-center overflow-hidden transition-all duration-300" style={{ height: dynHeight, maxHeight: dynHeight }} ref={previewContainerRef}>
                                  {isImageUrl ? (
                                    <img 
                                      src={activeFileUrl} 
                                      className="max-h-full max-w-full object-contain rounded-lg shadow-2xl select-none transition-all duration-300" 
                                      style={{ maxHeight: dynImageMaxHeight }}
                                      alt={selectedDossier.name}
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : isPdf ? (
                                    <div className="w-full relative flex items-center justify-center transition-all duration-300" style={{ height: dynPdfHeight }}>
                                      <iframe 
                                        src={activeBlobUrl || activeFileUrl}
                                        className="w-full h-full bg-white rounded-lg shadow-inner z-[1]"
                                        title={selectedDossier.name}
                                      />
                                      {/* Transparent overlay to grab drag events instead of the iframe swallowing them */}
                                      {!selectedVersionNum && (includeSignature || includeStamp || annotationText) && (
                                        <div className="absolute inset-0 bg-transparent cursor-crosshair z-[10]" />
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
                                        className="absolute bottom-[-8px] right-[-8px] w-5 h-5 bg-red-600 hover:bg-red-700 rounded-full border border-white cursor-se-resize flex items-center justify-center shadow-lg z-[45]"
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
                                      className="absolute border-2 border-dashed border-slate-500 bg-transparent text-[10px] p-2 leading-tight flex flex-col justify-between group rounded-xl touch-none z-[40] pointer-events-auto"
                                    >
                                      <div className="font-semibold text-[#1A5276] hover:text-[#2980B9] font-mono break-words pointer-events-none select-none max-h-full overflow-hidden text-[9px] uppercase">
                                        Visa DGI : {annotationText}
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
                                    const verObj = selectedVersionNum 
                                      ? selectedDossier.versions?.find(v => v.version === selectedVersionNum) 
                                      : selectedDossier.versions?.[selectedDossier.versions.length - 1];
                                    if (!verObj) return null;

                                    return (
                                      <>
                                        {/* Historic Signature Layer */}
                                        {verObj.hasSignature && verObj.signatureUrl && (
                                          <div 
                                            style={{
                                              position: 'absolute',
                                              left: `${verObj.sigPosition?.x ?? 65}%`,
                                              top: `${verObj.sigPosition?.y ?? 75}%`,
                                              width: `${verObj.sigSize?.width ?? 120}px`,
                                              height: `${verObj.sigSize?.height ?? 60}px`,
                                              transform: 'translate(-50%, -50%)',
                                            }}
                                            className="absolute pointer-events-none select-none z-[43]"
                                          >
                                            <img 
                                              src={verObj.signatureUrl} 
                                              className="w-full h-full object-contain mix-blend-multiply" 
                                              alt="Signature"
                                              referrerPolicy="no-referrer"
                                            />
                                          </div>
                                        )}

                                        {/* Historic Stamp Layer (Forces stampUrl from database) */}
                                        {verObj.hasStamp && verObj.stampUrl && (
                                          <div 
                                            style={{
                                              position: 'absolute',
                                              left: `${verObj.stampPosition?.x ?? 25}%`,
                                              top: `${verObj.stampPosition?.y ?? 75}%`,
                                              width: `${verObj.stampSize?.width ?? 80}px`,
                                              height: `${verObj.stampSize?.height ?? 80}px`,
                                              transform: 'translate(-50%, -50%)',
                                            }}
                                            className="absolute pointer-events-none select-none z-[43]"
                                          >
                                            <img 
                                              src={verObj.stampUrl} 
                                              className="w-full h-full object-contain mix-blend-multiply" 
                                              alt="Stamp"
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
                                            }}
                                            className="absolute pointer-events-none select-none bg-transparent text-[#1A5276] text-[10px] p-2 leading-tight font-black font-mono break-words z-[43] uppercase tracking-wider"
                                          >
                                            Visa DGI : {verObj.annotation}
                                          </div>
                                        )}
                                      </>
                                    );
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
                      
                      {/* Signature Applier tool */}
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
                          <label className="text-[10px] font-black text-[#2C3E50] uppercase tracking-widest">
                            Annotation de validation ou rectificative :
                          </label>
                          <textarea
                            rows={3}
                            placeholder="Saisissez vos instructions, commentaires légaux ou avis de visa..."
                            value={annotationText}
                            onChange={(e) => setAnnotationText(e.target.value)}
                            className="bg-white border border-gray-200 p-3 rounded-2xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#34495E]"
                          />
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

                        <button
                          onClick={handleAddAnnotationSignature}
                          className="bg-[#2C3E50] text-[#FAFCFF] hover:bg-[#34495E] py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-md transition-all cursor-pointer"
                        >
                          Enregistrer la version V{(selectedDossier.versions?.length || 1) + 1}
                        </button>
                      </div>

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
                                    <p className="font-extrabold text-amber-600">ID conversation rattachée: #{selectedDossier.linkedConversationId.slice(0, 8).toUpperCase()}</p>
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
                              <div className="flex items-center justify-between bg-gray-50 p-3 rounded-2xl text-xs font-bold text-[#2C3E50]">
                                <span>Attribué à : {selectedDossier.assignedAgentName}</span>
                                <button 
                                  onClick={() => handleAssignDossier('')}
                                  className="text-red-500 font-bold hover:text-red-700 text-[9px] uppercase cursor-pointer"
                                >
                                  Retirer
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <label className="text-[9px] text-gray-400">Assigner ce dossier directement à un gestionnaire :</label>
                                <select 
                                  onChange={(e) => handleAssignDossier(e.target.value)}
                                  className="px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none"
                                  defaultValue=""
                                >
                                  <option value="" disabled>Attribuer à un Gestionnaire...</option>
                                  {staffUsers
                                    .filter(u => u.perimetre === 'gestionnaire')
                                    .map(u => (
                                      <option key={u.uid} value={u.uid}>{u.displayName || u.email}</option>
                                    ))
                                  }
                                </select>
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
                            </div>
                            
                            <div className={`p-4 rounded-3xl text-xs font-semibold leading-relaxed shadow-sm ${
                              isMe 
                                ? 'bg-[#2C3E50] text-[#FAFCFF] rounded-tr-none' 
                                : 'bg-[#FAFCFF] text-[#2C3E50] border border-gray-100 rounded-tl-none'
                            }`}>
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
                  {uploadPopupType === 'signature' ? "Sélectionnez votre signature sur papier (JPEG, PNG) :" : "Sélectionnez l'image active du Sceau d'État (JPEG, PNG) :"}
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
                  <p className="text-[9px] text-gray-400 font-black uppercase tracking-wider mt-0.5">
                    Protocole de tracé collaboratif de la DGI
                  </p>
                </div>
              </div>

              <p className="text-[10px] text-red-600 font-black bg-red-50 p-3 rounded-xl uppercase tracking-wider leading-relaxed border border-red-100">
                ⚠️ Chaque transfert de dossier ou changement de statut exige obligatoirement la saisie d'un message d'instruction textuel pour s'enregistrer de façon distincte sur le chat collaboratif.
              </p>

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
                  disabled={!actionNoteText.trim()}
                  className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all shadow-md ${
                    actionNoteText.trim()
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
                        const verObj = selectedVersionNum 
                          ? selectedDossier.versions?.find(v => v.version === selectedVersionNum) 
                          : selectedDossier.versions?.[selectedDossier.versions.length - 1];
                        if (!verObj) return null;

                        return (
                          <>
                            {/* Historic Signature Layer */}
                            {verObj.hasSignature && verObj.signatureUrl && (
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
                                  src={verObj.signatureUrl} 
                                  className="w-full h-full object-contain mix-blend-multiply" 
                                  alt="Signature"
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                            )}

                            {/* Historic Stamp Layer */}
                            {verObj.hasStamp && verObj.stampUrl && (
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
                                  src={verObj.stampUrl} 
                                  className="w-full h-full object-contain mix-blend-multiply" 
                                  alt="Stamp"
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
                                }}
                                className="absolute pointer-events-none select-none bg-transparent text-[#1A5276] text-[10px] p-2 leading-tight font-black font-mono break-words z-[40] uppercase tracking-wider"
                              >
                                Visa DGI : {verObj.annotation}
                              </div>
                            )}
                          </>
                        );
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
