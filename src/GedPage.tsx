import React, { useState, useEffect } from 'react';
import { 
  Folder, FolderPlus, UploadCloud, Trash2, MoreVertical, 
  Lock, Unlock, Settings, ChevronRight, ArrowLeft, 
  AlertCircle, Eye, Download, Edit, Copy, Move, 
  Clipboard, X, Key, CheckCircle2, UserCheck, RefreshCw,
  Search, FileText, Grid, List, Plus, ShieldCheck, HardDrive,
  UserCircle, ShieldAlert, Users, Camera, Loader2
} from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, or, and, serverTimestamp, setDoc, deleteField } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth, hasPermission } from './App';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GedItem, AppUser } from './types';
import DocumentScanner from './DocumentScanner';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Let's implement safe file formatting icons
export const getFileIcon = (extension: string = '') => {
  const ext = extension.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
    return '🖼️';
  }
  if (['xls', 'xlsx', 'csv'].includes(ext)) {
    return '📊';
  }
  if (['doc', 'docx'].includes(ext)) {
    return '📝';
  }
  if (['ppt', 'pptx'].includes(ext)) {
    return '📉';
  }
  if (ext === 'pdf') {
    return '📕';
  }
  return '📁';
};

// Safe name generator to avoid duplicate names in the same folder
export const generateUniqueNameGed = (proposedName: string, existingNames: string[]): string => {
  if (!existingNames.map(n => n.toLowerCase()).includes(proposedName.toLowerCase())) {
    return proposedName;
  }
  
  let baseName = proposedName;
  let extension = '';
  const lastDot = proposedName.lastIndexOf('.');
  if (lastDot !== -1 && lastDot > 0) {
    baseName = proposedName.substring(0, lastDot);
    extension = proposedName.substring(lastDot);
  }
  
  let candidate = '';
  if (baseName.endsWith('-copie')) {
    candidate = `${baseName}-1${extension}`;
  } else if (/-copie-(\d+)$/.test(baseName)) {
    const match = baseName.match(/-copie-(\d+)$/);
    const num = parseInt(match![1]) + 1;
    candidate = `${baseName.replace(/-copie-\d+$/, `-copie-${num}`)}${extension}`;
  } else if (/\d+$/.test(baseName)) {
    const match = baseName.match(/(\d+)$/);
    const num = parseInt(match![1]) + 1;
    candidate = `${baseName.replace(/\d+$/, String(num))}${extension}`;
  } else {
    const hasExtension = extension !== '';
    if (hasExtension) {
      candidate = `${baseName}-copie${extension}`;
    } else {
      candidate = `${baseName}-2`;
    }
  }
  
  return generateUniqueNameGed(candidate, existingNames);
};

export default function GedPage() {
  // Check auth context. Wait, let's ensure we can read user from standard Firestore listeners or localStorage if context isn't globally exported.
  // We'll fallback to standard Firestore observer or useAuth.
  const authContext = useAuth();
  const user = authContext?.user as AppUser | null;
  const isSuperUser = user?.email === 'sibinimigjc@gmail.com';

  // Navigation states
  const [currentSpace, setCurrentSpace] = useState<'private' | 'administrative' | 'contributor' | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  
  // GED Data
  const [items, setItems] = useState<GedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showTrash, setShowTrash] = useState(false);

  // Clipboard for Copy / Paste operations
  const [clipboard, setClipboard] = useState<{ item: GedItem; action: 'copy' | 'move' } | null>(null);

  // Modals & Action overlays
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showRename, setShowRename] = useState<GedItem | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Trash notification
  const [trashWarning, setTrashWarning] = useState<GedItem | null>(null);
  
  // Passcode gating states
  const [isPrivateUnlocked, setIsPrivateUnlocked] = useState(false);
  const [showSetPrivatePasscode, setShowSetPrivatePasscode] = useState(false);
  const [privatePasscodeInput, setPrivatePasscodeInput] = useState('');
  const [privatePasscodeConfirm, setPrivatePasscodeConfirm] = useState('');
  const [privatePasscodeError, setPrivatePasscodeError] = useState('');
  
  const [enterPrivatePasscode, setEnterPrivatePasscode] = useState(false);
  const [verifyPrivatePasscodeVal, setVerifyPrivatePasscodeVal] = useState('');
  const [verifyPrivateError, setVerifyPrivateError] = useState('');

  // Global Administrative Passcode States
  const [globalGedPasscode, setGlobalGedPasscode] = useState<string>('');
  const [isAdministrativeUnlocked, setIsAdministrativeUnlocked] = useState(false);
  const [enterAdministrativePasscode, setEnterAdministrativePasscode] = useState(false);
  const [verifyAdministrativePasscodeVal, setVerifyAdministrativePasscodeVal] = useState('');
  const [verifyAdministrativeError, setVerifyAdministrativeError] = useState('');

  // Setup Global Passcode modal states
  const [showSetGlobalGedPasscodeModal, setShowSetGlobalGedPasscodeModal] = useState(false);
  const [globalGedPasscodeInput, setGlobalGedPasscodeInput] = useState('');
  const [globalGedPasscodeConfirm, setGlobalGedPasscodeConfirm] = useState('');
  const [globalGedPasscodeError, setGlobalGedPasscodeError] = useState('');

  // GED parameters modal states
  const [showGedSettings, setShowGedSettings] = useState(false);
  const [promptCheckCurrentCode, setPromptCheckCurrentCode] = useState<{
    target: 'disable_private' | 'change_private' | 'disable_administrative' | 'change_administrative';
  } | null>(null);
  const [checkCurrentCodeVal, setCheckCurrentCodeVal] = useState('');
  const [checkCurrentCodeError, setCheckCurrentCodeError] = useState('');

  // Global Admin locks for folders/files
  const [showLockSettingItem, setShowLockSettingItem] = useState<GedItem | null>(null);
  const [lockPasscodeInput, setLockPasscodeInput] = useState('');
  
  const [promptLockItem, setPromptLockItem] = useState<GedItem | null>(null);
  const [promptLockValue, setPromptLockValue] = useState('');
  const [promptLockError, setPromptLockError] = useState('');
  const [unlockedGlobalItemIds, setUnlockedGlobalItemIds] = useState<string[]>([]);

  // File Preview Modal
  const [previewItem, setPreviewItem] = useState<GedItem | null>(null);
  const [selectedPreviewVersion, setSelectedPreviewVersion] = useState<number | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [applySignatureOnVersion, setApplySignatureOnVersion] = useState(false);
  const [applyStampOnVersion, setApplyStampOnVersion] = useState(false);
  const [versionAnnotation, setVersionAnnotation] = useState('');
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);

  // Status & notifications
  const [statusText, setStatusText] = useState('');
  
  // Smart Scanner State
  const [showScanner, setShowScanner] = useState(false);

  // List of active conversations for linking dossiers
  const [conversations, setConversations] = useState<any[]>([]);
  const [linkingSearch, setLinkingSearch] = useState('');

  // Fetch active conversations for linking
  useEffect(() => {
    if (!user || user.role === 'contributor') return;
    const qConv = query(
      collection(db, 'conversations'),
      where('status', '==', 'open')
    );
    const unsubscribe = onSnapshot(qConv, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setConversations(list);
    }, (error) => {
      console.error("Error loading conversations in GedPage:", error);
    });
    return () => unsubscribe();
  }, [user]);

  // Fetch GED documents
  useEffect(() => {
    if (!user) return;
    setLoading(true);

    // Build the query
    // If Admin/Agent, can query all.
    // Let's fetch all items of the current chosen space.
    let q;
    if (user.role === 'contributor') {
      // Contributors only see their space
      q = query(
        collection(db, 'ged_items'),
        where('space', '==', 'contributor'),
        where('contributorId', '==', user.uid)
      );
    } else {
      // General staff/agents
      q = query(collection(db, 'ged_items'));
    }

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as GedItem));
      // Run internal trash purging calculation for items deleted more than 30 days ago
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      data.forEach(item => {
        if (item.isDeleted && item.deletedAt) {
          const delDate = item.deletedAt.toMillis ? item.deletedAt.toMillis() : new Date(item.deletedAt).getTime();
          if (now - delDate > thirtyDaysMs) {
            // Delete definitly inside Firebase
            deleteDoc(doc(db, 'ged_items', item.id));
          }
        }
      });

      setItems(data);
      setLoading(false);
    }, (err) => {
      console.error(err);
      setLoading(false);
    });

    return () => unsub();
  }, [user]);

  // Handle status timer
  useEffect(() => {
    if (statusText) {
      const timer = setTimeout(() => setStatusText(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusText]);

  // Listen for global administrative passcode
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'branding'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setGlobalGedPasscode(data.globalGedPasscode || '');
      }
    });
    return () => unsub();
  }, []);

  // Enforce single viewport for taxpayer contributors (Espace Administratif / Gestion des dossiers)
  useEffect(() => {
    if (user?.role === 'contributor' && currentSpace !== 'contributor') {
      setCurrentSpace('contributor');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    }
  }, [user, currentSpace]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-10 bg-[#F4F7F6]">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-black text-[#2C3E50] uppercase tracking-wider">Session expirée</h2>
        <p className="text-xs text-gray-400 mt-2">Veuillez vous reconnecter pour accéder au module GED.</p>
      </div>
    );
  }

  // Choose Espace Aiguillage
  const handleSelectSpace = (space: 'private' | 'administrative' | 'contributor') => {
    if (user.role === 'contributor') {
      setCurrentSpace('contributor');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
      return;
    }

    if (space === 'private') {
      // Check private passcode lock
      if (user.gedPasscode && !isPrivateUnlocked && !isSuperUser) {
        setEnterPrivatePasscode(true);
        setVerifyPrivatePasscodeVal('');
        setVerifyPrivateError('');
      } else {
        setCurrentSpace('private');
        setCurrentFolderId(null);
        setBreadcrumbs([]);
      }
    } else if (space === 'administrative') {
      // Check admin views restriction unless SuperUser
      if (user.restrictGedAdmin && !isSuperUser) {
        setStatusText("Accès refusé : Votre administrateur a restreint votre accès à cet espace.");
        return;
      }
      // Check if global passcode is set and space is not yet unlocked
      if (globalGedPasscode && !isAdministrativeUnlocked && !isSuperUser) {
        setEnterAdministrativePasscode(true);
        setVerifyAdministrativePasscodeVal('');
        setVerifyAdministrativeError('');
      } else {
        setCurrentSpace('administrative');
        setCurrentFolderId(null);
        setBreadcrumbs([]);
      }
    }
  };

  // Verify passcode Administrative
  const handleVerifyAdministrativePasscode = () => {
    if (verifyAdministrativePasscodeVal === globalGedPasscode || isSuperUser) {
      setIsAdministrativeUnlocked(true);
      setEnterAdministrativePasscode(false);
      setCurrentSpace('administrative');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } else {
      setVerifyAdministrativeError("Code secret incorrect. Accès refusé.");
    }
  };

  // Set global Administrative passcode
  const handleSetGlobalGedPasscode = async () => {
    if (!globalGedPasscodeInput || globalGedPasscodeInput.length < 4) {
      setGlobalGedPasscodeError("Le code doit avoir au moins 4 caractères.");
      return;
    }
    if (globalGedPasscodeInput !== globalGedPasscodeConfirm) {
      setGlobalGedPasscodeError("Les codes ne correspondent pas.");
      return;
    }
    try {
      await setDoc(doc(db, 'settings', 'branding'), {
        globalGedPasscode: globalGedPasscodeInput
      }, { merge: true });
      setIsAdministrativeUnlocked(true);
      setShowSetGlobalGedPasscodeModal(false);
      setStatusText("Code d'accès global administratif enregistré avec succès !");
      setCurrentSpace('administrative');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } catch (e) {
      console.error(e);
      setGlobalGedPasscodeError("Erreur d'écriture.");
    }
  };

  // Deactivate or modify private / administrative passcode only with correct current passcode verification
  const handleVerifyCurrentCodeBeforeAction = async () => {
    if (!promptCheckCurrentCode) return;
    
    if (promptCheckCurrentCode.target === 'disable_private' || promptCheckCurrentCode.target === 'change_private') {
      // Check private passcode
      if (checkCurrentCodeVal !== user.gedPasscode && !isSuperUser) {
        setCheckCurrentCodeError("Code d'accès actuel incorrect.");
        return;
      }
      
      if (promptCheckCurrentCode.target === 'disable_private') {
        try {
          await updateDoc(doc(db, 'users', user.uid), {
            gedPasscode: null
          });
          setIsPrivateUnlocked(false);
          setPromptCheckCurrentCode(null);
          setStatusText("Verrouillage de l'Espace Privé désactivé avec succès !");
        } catch (e) {
          console.error(e);
          setCheckCurrentCodeError("Erreur d'écriture.");
        }
      } else {
        // Change
        setPromptCheckCurrentCode(null);
        setShowSetPrivatePasscode(true);
        setPrivatePasscodeInput('');
        setPrivatePasscodeConfirm('');
        setPrivatePasscodeError('');
      }
    } else if (promptCheckCurrentCode.target === 'disable_administrative' || promptCheckCurrentCode.target === 'change_administrative') {
      // Check global passcode
      if (checkCurrentCodeVal !== globalGedPasscode && !isSuperUser) {
        setCheckCurrentCodeError("Code de direction actuel incorrect.");
        return;
      }
      
      if (promptCheckCurrentCode.target === 'disable_administrative') {
        try {
          await setDoc(doc(db, 'settings', 'branding'), {
            globalGedPasscode: null
          }, { merge: true });
          setIsAdministrativeUnlocked(false);
          setPromptCheckCurrentCode(null);
          setStatusText("Verrouillage de l'Espace Administratif désactivé avec succès !");
        } catch (e) {
          console.error(e);
          setCheckCurrentCodeError("Erreur d'écriture.");
        }
      } else {
        // Change
        setPromptCheckCurrentCode(null);
        setShowSetGlobalGedPasscodeModal(true);
        setGlobalGedPasscodeInput('');
        setGlobalGedPasscodeConfirm('');
        setGlobalGedPasscodeError('');
      }
    }
  };

  // Lock Private setup
  const handleSetPrivatePasscode = async () => {
    if (!privatePasscodeInput || privatePasscodeInput.length < 4) {
      setPrivatePasscodeError("Le code doit avoir au moins 4 caractères.");
      return;
    }
    if (privatePasscodeInput !== privatePasscodeConfirm) {
      setPrivatePasscodeError("Les codes ne correspondent pas.");
      return;
    }
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        gedPasscode: privatePasscodeInput
      });
      setIsPrivateUnlocked(true);
      setShowSetPrivatePasscode(false);
      setStatusText("Code d'accès privé enregistré avec succès !");
      setCurrentSpace('private');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } catch (e) {
      console.error(e);
      setPrivatePasscodeError("Erreur d'écriture.");
    }
  };

  // Verify passcode Private
  const handleVerifyPrivatePasscode = () => {
    if (verifyPrivatePasscodeVal === user.gedPasscode || isSuperUser) {
      setIsPrivateUnlocked(true);
      setEnterPrivatePasscode(false);
      setCurrentSpace('private');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } else {
      setVerifyPrivateError("Code secret incorrect. Accès refusé.");
    }
  };

  // Filter current items of current view
  const getVisibleItems = () => {
    if (!currentSpace) return [];
    
    // Filter by space, parentFolder, and soft-deleted state
    return items.filter(item => {
      // Space matching
      if (item.space !== currentSpace) return false;
      
      // Ownership check for private (unless SuperUser)
      if (currentSpace === 'private' && item.ownerId !== user.uid && !isSuperUser) return false;
      
      // contributor space matching
      if (currentSpace === 'contributor' && user.role === 'contributor' && item.contributorId !== user.uid) return false;

      // Trash list configuration
      if (showTrash) {
        return item.isDeleted === true;
      } else {
        if (item.isDeleted === true) return false;
      }

      // Folder navigation hierarchy matching
      return item.parentId === currentFolderId;
    }).filter(item => {
      // Search term filtering
      if (!searchQuery) return true;
      const nameMatch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const ocrMatch = item.extractedText?.toLowerCase().includes(searchQuery.toLowerCase());
      return nameMatch || ocrMatch;
    });
  };

  // Create Folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentSpace) return;

    try {
      const existingInFolder = items
        .filter(i => i.space === currentSpace && i.parentId === currentFolderId && !i.isDeleted)
        .map(i => i.name);
      
      const uniqueName = generateUniqueNameGed(newFolderName.trim(), existingInFolder);

      const newItem: Partial<GedItem> = {
        name: uniqueName,
        type: 'folder',
        parentId: currentFolderId,
        space: currentSpace,
        ownerId: user.uid,
        ownerEmail: user.email,
        isDeleted: false,
        createdBy: {
          uid: user.uid,
          displayName: user.displayName || 'Agent',
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          matricule: user.matricule || 'N/A'
        },
        createdAt: serverTimestamp()
      };

      if (currentSpace === 'contributor') {
        newItem.contributorId = user.role === 'contributor' ? user.uid : (currentFolderId ? items.find(f => f.id === currentFolderId)?.contributorId : '');
      }

      await addDoc(collection(db, 'ged_items'), newItem);
      setNewFolderName('');
      setShowCreateFolder(false);
      setStatusText(`Dossier "${uniqueName}" créé !`);
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors de la création du dossier.");
    }
  };

  // Handle local file picking & conversion to base64
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentSpace) return;

    // Supported formats checking
    const supportedExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!supportedExtensions.includes(fileExtension)) {
      setStatusText("Format non pris en charge. Formats valides : PDF, Word, Excel, PowerPoint, PNG, JPG.");
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Url = event.target?.result as string;
        
        const existingInFolder = items
          .filter(i => i.space === currentSpace && i.parentId === currentFolderId && !i.isDeleted)
          .map(i => i.name);
        
        const uniqueName = generateUniqueNameGed(file.name, existingInFolder);

        const newItem: Partial<GedItem> = {
          name: uniqueName,
          type: 'file',
          parentId: currentFolderId,
          space: currentSpace,
          ownerId: user.uid,
          ownerEmail: user.email,
          extension: fileExtension,
          fileUrl: base64Url,
          fileSize: file.size,
          isDeleted: false,
          createdBy: {
            uid: user.uid,
            displayName: user.displayName || 'Agent',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            matricule: user.matricule || 'N/A'
          },
          createdAt: serverTimestamp()
        };

        if (currentSpace === 'contributor') {
          newItem.contributorId = user.role === 'contributor' ? user.uid : (currentFolderId ? items.find(f => f.id === currentFolderId)?.contributorId : '');
        }

        await addDoc(collection(db, 'ged_items'), newItem);
        setStatusText(`Document "${uniqueName}" téléversé !`);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors du téléversement.");
    }
  };

  // Convert scanned physical file and save to active GED
  const importScannedFileToGed = async (file: File) => {
    if (!currentSpace) return;
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || 'pdf';

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Url = event.target?.result as string;
        
        const existingInFolder = items
          .filter(i => i.space === currentSpace && i.parentId === currentFolderId && !i.isDeleted)
          .map(i => i.name);
        
        const uniqueName = generateUniqueNameGed(file.name, existingInFolder);

        const newItem: Partial<GedItem> = {
          name: uniqueName,
          type: 'file',
          parentId: currentFolderId,
          space: currentSpace,
          ownerId: user.uid,
          ownerEmail: user.email,
          extension: fileExtension,
          fileUrl: base64Url,
          fileSize: file.size,
          isDeleted: false,
          extractedText: (file as any).extractedText || '',
          createdBy: {
            uid: user.uid,
            displayName: user.displayName || 'Agent',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            matricule: user.matricule || 'N/A'
          },
          createdAt: serverTimestamp()
        };

        if (currentSpace === 'contributor') {
          newItem.contributorId = user.role === 'contributor' ? user.uid : (currentFolderId ? items.find(f => f.id === currentFolderId)?.contributorId : '');
        }

        await addDoc(collection(db, 'ged_items'), newItem);
        setStatusText(`Document "${uniqueName}" numérisé et enregistré !`);
        setShowScanner(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors de l'enregistrement du scan.");
    }
  };

  const handleUpdateStatus = async (itemId: string, newStatus: 'Nouveau' | 'En cours' | 'Terminé' | 'Terminé / Envoyé' | 'Archivé') => {
    if (!user) return;
    
    // Check hierarchical authorization to revert from 'Terminé / Envoyé' (or 'Terminé') to 'En cours'
    const currentStatus = previewItem?.status || 'Nouveau';
         if ((currentStatus === 'Terminé / Envoyé' || currentStatus === 'Terminé') && newStatus === 'En cours') {
      const isAuthorized = user.role === 'admin' || 
                           (user.perimetre && ['admin_bureau', 'superviseur', 'superviseur_senior'].includes(user.perimetre));
      if (!isAuthorized) {
        setStatusText("Accès refusé : Votre niveau hiérarchique ne vous permet pas de repasser ce dossier au statut 'En cours'.");
        return;
      }
    }

    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'CHANGEMENT_STATUT',
        description: `Changement de statut : de "${previewItem?.status || 'Nouveau'}" à "${newStatus}"`,
        timestamp: new Date().toISOString()
      };
      
      const currentLogs = previewItem?.historyLogs || [];
      const updatedLogs = [...currentLogs, logEntry];

      // Auto-clôture de la conversation liée si nouveau statut est 'Terminé / Envoyé' ou 'Terminé'
      if ((newStatus === 'Terminé / Envoyé' || newStatus === 'Terminé') && previewItem?.linkedConversationId) {
        const convId = previewItem.linkedConversationId;
        const convRef = doc(db, 'conversations', convId);
        
        // Fetch snapshot manually to be secure
        const { getDoc } = await import('firebase/firestore');
        const convSnap = await getDoc(convRef);
        if (convSnap.exists()) {
          const convData = convSnap.data();
          const contributorId = convData.contributorId || '';
          const participants = convData.participants || [];
          
          const systemMsg = "Votre dossier a été traité avec succès par les services de la DGI.";
          
          // Send automatic closing message in the chat
          await addDoc(collection(db, 'conversations', convId, 'messages'), {
            body: systemMsg,
            participants: participants,
            senderId: 'system',
            senderName: 'Système DGI',
            receiverId: contributorId,
            attachments: [],
            hasAttachments: false,
            createdAt: serverTimestamp(),
            conversationId: convId
          });
          
          // Update conversation to closed mode (Lecture seule)
          await updateDoc(convRef, {
            isClosed: true,
            status: 'closed',
            closedAt: serverTimestamp(),
            closedBy: 'Système DGI (Clôture automatique après traitement de dossier)',
            lastUpdate: serverTimestamp(),
            lastMessagePreview: systemMsg
          });
          
          // Log inside the dossier logs
          const autoCloseLog = {
            id: Math.random().toString(36).slice(-6),
            authorName: 'Système DGI',
            authorRole: 'Serveur de messagerie',
            action: 'CLOTURE_CONVERSATION_AUTOMATIQUE',
            description: `Le dossier est Terminé. La conversation liée ID #GED-${convId.slice(0,8).toUpperCase()} a été clôturée et notifiée automatiquement.`,
            timestamp: new Date().toISOString()
          };
          updatedLogs.push(autoCloseLog);
        }
      }
      
      await updateDoc(doc(db, 'ged_items', itemId), {
        status: newStatus,
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      
      setPreviewItem(prev => prev ? { ...prev, status: newStatus, historyLogs: updatedLogs } : null);
      setStatusText(`Statut du dossier mis à jour à "${newStatus}"`);
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors de la mise à jour du statut.");
    }
  };

  const handleLinkToConversation = async (itemId: string, convId: string) => {
    if (!user) return;
    try {
      const selectedConvObj = conversations.find(c => c.id === convId);
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'LIAISON_CONVERSATION',
        description: `Dossier lié à la conversation #${convId.slice(0, 8).toUpperCase()}${selectedConvObj ? ` de ${selectedConvObj.contributorName || 'Contribuable'} (Sujet: ${selectedConvObj.subject})` : ''}`,
        timestamp: new Date().toISOString()
      };
      
      const currentLogs = previewItem?.historyLogs || [];
      const updatedLogs = [...currentLogs, logEntry];
      
      await updateDoc(doc(db, 'ged_items', itemId), {
        linkedConversationId: convId,
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      
      setPreviewItem(prev => prev ? { ...prev, linkedConversationId: convId, historyLogs: updatedLogs } : null);
      setStatusText("Dossier lié avec succès à la conversation !");
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors de la liaison du dossier.");
    }
  };

  const handleUnlinkFromConversation = async (itemId: string) => {
    if (!user) return;
    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'DELIAISON_CONVERSATION',
        description: `Dossier détaché de la conversation #${previewItem?.linkedConversationId?.slice(0, 8).toUpperCase()}`,
        timestamp: new Date().toISOString()
      };
      
      const currentLogs = previewItem?.historyLogs || [];
      const updatedLogs = [...currentLogs, logEntry];
      
      await updateDoc(doc(db, 'ged_items', itemId), {
        linkedConversationId: deleteField(),
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      
      setPreviewItem(prev => {
        if (!prev) return null;
        const copy = { ...prev, historyLogs: updatedLogs };
        delete copy.linkedConversationId;
        return copy;
      });
      setStatusText("Dossier détaché avec succès !");
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors du détachement du dossier.");
    }
  };

  const handleAddComment = async (itemId: string) => {
    if (!user || !commentInput.trim()) return;
    try {
      const logEntry = {
        id: Math.random().toString(36).slice(-6),
        authorName: user.displayName || 'Agent',
        authorRole: user.poste || 'Agent DGI',
        action: 'COMMENTAIRE',
        description: `Note/Commentaire : "${commentInput.trim()}"`,
        timestamp: new Date().toISOString()
      };
      
      const currentLogs = previewItem?.historyLogs || [];
      const updatedLogs = [...currentLogs, logEntry];
      
      await updateDoc(doc(db, 'ged_items', itemId), {
        historyLogs: updatedLogs,
        updatedAt: serverTimestamp()
      });
      
      setPreviewItem(prev => prev ? { ...prev, historyLogs: updatedLogs } : null);
      setCommentInput('');
      setStatusText("Note ajoutée avec succès !");
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors de l'ajout du commentaire.");
    }
  };

  const handleUploadNewVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !previewItem || !user) return;
    
    setIsUploadingVersion(true);
    setStatusText("Traitement de la nouvelle version...");
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Url = event.target?.result as string;
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            
            // Check if user has signature and requested applying it
            if (applySignatureOnVersion && user.signatureUrl) {
              const sigImg = new Image();
              sigImg.crossOrigin = 'anonymous';
              await new Promise((resolve) => {
                sigImg.onload = () => {
                  const sigW = canvas.width * 0.22;
                  const sigH = (sigImg.height / sigImg.width) * sigW;
                  ctx.drawImage(sigImg, canvas.width - sigW - 30, canvas.height - sigH - 30, sigW, sigH);
                  resolve(true);
                };
                sigImg.src = user.signatureUrl;
              });
            }
            
            // Stamp
            if (applyStampOnVersion && user.stampUrl) {
              const stampImg = new Image();
              stampImg.crossOrigin = 'anonymous';
              await new Promise((resolve) => {
                stampImg.onload = () => {
                  const stampW = canvas.width * 0.22;
                  const stampH = (stampImg.height / stampImg.width) * stampW;
                  ctx.drawImage(stampImg, 30, canvas.height - stampH - 30, stampW, stampH);
                  resolve(true);
                };
                stampImg.src = user.stampUrl;
              });
            }
            
            const processedBase64 = canvas.toDataURL('image/jpeg', 0.90);
            const currentVersions = previewItem.versions || [];
            const nextVerNum = currentVersions.length + 1;
            
            const newVersion = {
              version: nextVerNum,
              fileUrl: processedBase64,
              annotation: versionAnnotation || `Version ${nextVerNum} chargée`,
              hasSignature: applySignatureOnVersion,
              hasStamp: applyStampOnVersion,
              createdBy: user.uid,
              createdByName: user.displayName || 'Agent',
              createdByRole: user.poste || 'DGI Agent',
              createdAt: new Date().toISOString()
            };
            
            const actionText = `Version v${nextVerNum} créée` + 
              (applySignatureOnVersion ? ' (Signée électroniquement)' : '') + 
              (applyStampOnVersion ? ' (Cachet administratif apposé)' : '') + 
              (versionAnnotation ? ` - Commentaire : "${versionAnnotation}"` : '');
              
            const logEntry = {
              id: Math.random().toString(36).slice(-6),
              authorName: user.displayName || 'Agent',
              authorRole: user.poste || 'Agent DGI',
              action: 'VERSION_AJOUTE',
              description: actionText,
              timestamp: new Date().toISOString()
            };
            
            const updatedVersions = [...currentVersions, newVersion];
            const updatedLogs = [...(previewItem.historyLogs || []), logEntry];
            
            await updateDoc(doc(db, 'ged_items', previewItem.id), {
              versions: updatedVersions,
              historyLogs: updatedLogs,
              updatedAt: serverTimestamp()
            });
            
            setPreviewItem(prev => prev ? { ...prev, versions: updatedVersions, historyLogs: updatedLogs } : null);
            setSelectedPreviewVersion(nextVerNum);
            
            // Reset input form
            setApplySignatureOnVersion(false);
            setApplyStampOnVersion(false);
            setVersionAnnotation('');
            setIsUploadingVersion(false);
            setStatusText(`Version ${nextVerNum} enregistrée avec succès !`);
          }
        };
        img.src = base64Url;
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setStatusText("Erreur lors du traitement de la nouvelle version.");
      setIsUploadingVersion(false);
    }
  };

  // Navigation down
  const handleOpenFolder = (folder: GedItem) => {
    // Check global admin password lock on this folder unless SuperUser
    if (folder.isLocked && !unlockedGlobalItemIds.includes(folder.id) && !isSuperUser) {
      setPromptLockItem(folder);
      setPromptLockValue('');
      setPromptLockError('');
      return;
    }

    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
  };

  // Verify Global Lock on items
  const handleVerifyGlobalLock = () => {
    if (!promptLockItem) return;
    if (promptLockValue === promptLockItem.lockPasscode || isSuperUser) {
      setUnlockedGlobalItemIds(prev => [...prev, promptLockItem.id]);
      setPromptLockItem(null);
      // Open folder directly or preview if file
      if (promptLockItem.type === 'folder') {
        setCurrentFolderId(promptLockItem.id);
        setBreadcrumbs(prev => [...prev, { id: promptLockItem.id, name: promptLockItem.name }]);
      } else {
        setPreviewItem(promptLockItem);
      }
    } else {
      setPromptLockError("Code d'accès incorrect.");
    }
  };

  // Navigation breadcrumb clicks
  const handleBreadcrumbClick = (idx: number) => {
    if (idx === -1) {
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } else {
      const destination = breadcrumbs[idx];
      setCurrentFolderId(destination.id);
      setBreadcrumbs(breadcrumbs.slice(0, idx + 1));
    }
  };

  // Setup/Toggle locks
  const handleApplyLockOnItem = async () => {
    if (!showLockSettingItem) return;
    try {
      await updateDoc(doc(db, 'ged_items', showLockSettingItem.id), {
        isLocked: !!lockPasscodeInput.trim(),
        lockPasscode: lockPasscodeInput.trim() || null
      });
      setStatusText(lockPasscodeInput.trim() ? "Verrouillage appliqué." : "Verrouillage supprimé.");
      setShowLockSettingItem(null);
      setLockPasscodeInput('');
    } catch (e) {
      console.error(e);
      setStatusText("Erreur lors de l'application du verrou.");
    }
  };

  // Soft deletion handler (Trash bin)
  const handleSoftDelete = async (item: GedItem) => {
    try {
      await updateDoc(doc(db, 'ged_items', item.id), {
        isDeleted: true,
        deletedAt: serverTimestamp()
      });
      setStatusText(`"${item.name}" déplacé dans la corbeille pendant 30 jours.`);
      setTrashWarning(null);
    } catch (e) {
      console.error(e);
      setStatusText("Erreur de suppression");
    }
  };

  // Restore from trash
  const handleRestoreItem = async (item: GedItem) => {
    try {
      await updateDoc(doc(db, 'ged_items', item.id), {
        isDeleted: false,
        deletedAt: null
      });
      setStatusText(`"${item.name}" restauré avec succès.`);
    } catch (e) {
      console.error(e);
    }
  };

  // Hard delete
  const handleHardDeleteItem = async (item: GedItem) => {
    if (!confirm(`Confirmer la suppression irréversible de "${item.name}" ?`)) return;
    try {
      await deleteDoc(doc(db, 'ged_items', item.id));
      setStatusText(`"${item.name}" supprimé définitivement.`);
    } catch (e) {
      console.error(e);
    }
  };

  // Pre-deletion warning popup
  const triggerDeleteWithWarning = (item: GedItem) => {
    setTrashWarning(item);
  };

  // Rename action
  const handleRenameItem = async () => {
    if (!showRename || !renameValue.trim()) return;
    try {
      const existingInFolder = items
        .filter(i => i.space === currentSpace && i.parentId === currentFolderId && !i.isDeleted && i.id !== showRename.id)
        .map(i => i.name);
      
      const uniqueName = generateUniqueNameGed(renameValue.trim(), existingInFolder);

      await updateDoc(doc(db, 'ged_items', showRename.id), {
        name: uniqueName
      });
      setStatusText(`Nommé "${uniqueName}" avec succès !`);
      setShowRename(null);
      setRenameValue('');
    } catch (e) {
      console.error(e);
      setStatusText("Erreur de renommage.");
    }
  };

  // Clipboard operations
  const handleCopyTo = (item: GedItem) => {
    setClipboard({ item, action: 'copy' });
    setStatusText(`"${item.name}" copié dans le presse-papiers.`);
  };

  const handleMoveTo = (item: GedItem) => {
    setClipboard({ item, action: 'move' });
    setStatusText(`"${item.name}" prêt à être déplacé.`);
  };

  const handlePasteHere = async () => {
    if (!clipboard || !currentSpace) return;
    try {
      const item = clipboard.item;
      const existingInFolder = items
        .filter(i => i.space === currentSpace && i.parentId === currentFolderId && !i.isDeleted)
        .map(i => i.name);

      if (clipboard.action === 'move') {
        // Just move the item parent references
        const uniqueName = generateUniqueNameGed(item.name, existingInFolder);
        await updateDoc(doc(db, 'ged_items', item.id), {
          parentId: currentFolderId,
          space: currentSpace,
          name: uniqueName
        });
        setStatusText(`"${uniqueName}" déplacé ici !`);
      } else {
        // Copy: Create a completely new document copy
        const uniqueName = generateUniqueNameGed(item.name, existingInFolder);
        const duplicatedItem: Partial<GedItem> = {
          name: uniqueName,
          type: item.type,
          parentId: currentFolderId,
          space: currentSpace,
          ownerId: user.uid,
          ownerEmail: user.email,
          isDeleted: false,
          createdBy: {
            uid: user.uid,
            displayName: user.displayName || 'AgentCopy',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            matricule: user.matricule || 'N/A'
          },
          createdAt: serverTimestamp()
        };

        if (item.type === 'file') {
          duplicatedItem.extension = item.extension;
          duplicatedItem.fileSize = item.fileSize;
          duplicatedItem.fileUrl = item.fileUrl;
        }

        await addDoc(collection(db, 'ged_items'), duplicatedItem);
        setStatusText(`"${uniqueName}" copié ici !`);
      }
      setClipboard(null);
    } catch (e) {
      console.error(e);
      setStatusText("Erreur lors du collage.");
    }
  };

  // Action dropdown toggle per row
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  return (
    <div className="p-8 md:p-10 h-full flex flex-col bg-[#F8FAFC] font-sans relative">
      {/* Toast Alert Banner */}
      {statusText && (
        <div className="fixed top-24 right-10 z-[110] animate-in slide-in-from-right duration-300">
          <div className="bg-primary text-white px-6 py-4 rounded-3xl shadow-xl flex items-center gap-3 border border-white/20">
            <CheckCircle2 size={18} className="text-green-400 shrink-0" />
            <span className="text-xs font-black uppercase tracking-widest">{statusText}</span>
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-[#2C3E50] tracking-tight uppercase italic flex items-center gap-3">
            <HardDrive size={32} className="text-primary" />
            {user.role === 'contributor' ? 'Gestion des dossiers' : 'Gestionnaire Électronique de Documents (GED)'}
          </h1>
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2">
            Système d'archivage réglementaire et sécurisé de la DGI • Service Connecté
          </p>
        </div>

        {/* Toolbar of buttons */}
        {currentSpace && (
          <div className="flex flex-wrap items-center gap-3">
            {user.role !== 'contributor' && (
              <button 
                onClick={() => {
                  setShowGedSettings(true);
                  setCheckCurrentCodeVal('');
                  setCheckCurrentCodeError('');
                }}
                className="px-5 py-3 bg-white border border-gray-100 rounded-2xl text-[9px] font-black text-gray-500 hover:text-primary hover:border-primary uppercase tracking-wider hover:bg-gray-50 active:scale-95 transition-all shadow-sm flex items-center gap-2"
                title="Paramètres de sécurité de la GED"
              >
                <Settings size={14} /> Sécurité GED
              </button>
            )}

            <button 
              onClick={() => { setShowTrash(!showTrash); }}
              className={cn(
                "px-5 py-3 rounded-2xl text-[9px] font-black uppercase tracking-wider transition-all border shadow-sm flex items-center gap-2",
                showTrash ? "bg-red-50 text-red-600 border-red-100" : "bg-white text-gray-400 hover:text-gray-600 border-gray-100"
              )}
            >
              <Trash2 size={14} /> Corbeille {showTrash ? 'ouverte' : ''}
            </button>

            {/* Quick Create buttons always accessible everywhere inside a space except when inside wastebasket view */}
            {!showTrash && (
              <>
                <button 
                  onClick={() => setShowCreateFolder(true)}
                  className="px-5 py-3 bg-white border border-gray-100 rounded-2xl text-[9px] font-black text-[#2C3E50] uppercase tracking-wider hover:border-primary hover:text-primary active:scale-95 transition-all shadow-sm flex items-center gap-2"
                >
                  <FolderPlus size={14} /> Créer un dossier
                </button>

                <label className="px-5 py-3 bg-primary text-white rounded-2xl text-[9px] font-black uppercase tracking-wider hover:brightness-115 active:scale-95 transition-all shadow-lg shadow-primary/20 flex items-center gap-2 cursor-pointer">
                  <UploadCloud size={14} /> Téléverser un document
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>

                <button 
                  onClick={() => setShowScanner(true)}
                  className="px-5 py-3 bg-[#0284C7] hover:bg-[#0369A1] text-white rounded-2xl text-[9px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-lg shadow-sky-600/15 flex items-center gap-2 cursor-pointer"
                >
                  <Camera size={14} /> Numériser un document
                </button>
              </>
            )}

            {/* Paste clipboard option */}
            {clipboard && !showTrash && (
              <button 
                onClick={handlePasteHere}
                className="px-5 py-3 bg-green-50 text-green-700 border border-green-100 rounded-2xl text-[9px] font-black uppercase tracking-wider hover:bg-green-100 active:scale-95 transition-all shadow-sm flex items-center gap-2"
                title={`Coller: ${clipboard.item.name}`}
              >
                <Clipboard size={14} /> Coller ici ({clipboard.action === 'copy' ? 'Copie' : 'Déplacement'})
              </button>
            )}

            {/* Change views buttons */}
            <div className="flex p-0.5 bg-gray-100 rounded-xl border border-gray-200/50">
              <button onClick={() => setViewMode('grid')} className={cn("p-2 rounded-lg", viewMode === 'grid' ? "bg-white text-primary shadow-sm" : "text-gray-400")}><Grid size={14} /></button>
              <button onClick={() => setViewMode('list')} className={cn("p-2 rounded-lg", viewMode === 'list' ? "bg-white text-primary shadow-sm" : "text-gray-400")}><List size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {/* Aiguillage / Choice interface: Private / Administrative */}
      {!currentSpace ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="bg-white p-10 md:p-12 rounded-[3.5rem] border border-gray-100 shadow-2xl max-w-2xl w-full text-center">
            <div className="w-20 h-20 bg-primary/5 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
              <HardDrive size={44} />
            </div>
            <h2 className="text-2xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-2">Aiguillage de votre Session GED</h2>
            <p className="text-xs text-gray-400 max-w-md mx-auto mb-10 leading-relaxed">
              Veuillez choisir le périmètre de documents sur lequel vous souhaitez travailler dans ce module sécurisé.
            </p>

            <div className={cn("grid gap-6 text-left", user.role === 'contributor' ? "grid-cols-1 max-w-sm mx-auto" : "grid-cols-1 md:grid-cols-2")}>
              {/* Private Space Box */}
              {user.role !== 'contributor' && (
                <button 
                  onClick={() => handleSelectSpace('private')}
                  className="p-8 bg-gray-50 hover:bg-white hover:shadow-2xl hover:scale-[1.03] border border-gray-100 hover:border-primary/20 rounded-[2.5rem] transition-all group flex flex-col justify-between"
                >
                  <div>
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-inner">
                      <UserCircle size={24} />
                    </div>
                    <h3 className="text-base font-black text-[#2C3E50] group-hover:text-primary transition-colors">Espace Privé</h3>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2 leading-relaxed">
                      Silo de documents propre à votre compte. Possibilité de verrouillage par code personnel.
                    </p>
                  </div>
                </button>
              )}

              {/* Administrative Space Box */}
              <button 
                onClick={() => handleSelectSpace('administrative')}
                className={cn(
                  "p-8 bg-gray-50 hover:bg-white hover:shadow-2xl hover:scale-[1.03] border border-gray-100 hover:border-primary/20 rounded-[2.5rem] transition-all group flex flex-col justify-between",
                  user.restrictGedAdmin && !isSuperUser && "opacity-55 cursor-not-allowed"
                )}
              >
                <div>
                  <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-inner">
                    <ShieldCheck size={24} />
                  </div>
                  <h3 className="text-base font-black text-[#2C3E50] group-hover:text-primary transition-colors">
                    {user.role === 'contributor' ? 'Gestion des dossiers (Espace Administratif)' : 'Espace Administratif'}
                  </h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2 leading-relaxed">
                    {user.role === 'contributor' ? 'Accédez directement à vos dossiers professionnels de déclaration et de suivi fiscal.' : "Fichiers d'exercice de la DGI ou dossiers d'habilitation. Droits restreints par les administrateurs."}
                  </p>
                </div>
              </button>
            </div>

            {/* Dual Security Warnings */}
            <div className="space-y-4 mt-8">
              {/* Alerte 1 (Espace Privé) — For everyone (agents/admins/Super-Admin) if private passcode is missing */}
              {(user.role === 'agent' || user.role === 'admin' || isSuperUser) && !user.gedPasscode && (
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-2xl text-left flex items-center justify-between gap-4">
                  <div className="flex gap-3">
                    <AlertCircle size={20} className="text-orange-500 shrink-0" />
                    <div>
                      <h5 className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Alerte Sécurité - Espace Privé</h5>
                      <p className="text-[9px] text-orange-500 font-bold mt-1">Vous n'avez pas encore défini de code de verrouillage pour votre Espace Privé.</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setShowSetPrivatePasscode(true);
                      setPrivatePasscodeInput('');
                      setPrivatePasscodeConfirm('');
                      setPrivatePasscodeError('');
                    }}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-black text-[9px] uppercase tracking-wider rounded-xl transition-all shadow-sm shrink-0"
                  >
                    Configurer code
                  </button>
                </div>
              )}

              {/* Alerte 2 (Espace Administratif) — For Super-Admin and Admins only, if global passcode is missing */}
              {(user.role === 'admin' || isSuperUser) && !globalGedPasscode && (
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl text-left flex items-center justify-between gap-4">
                  <div className="flex gap-3">
                    <ShieldAlert size={20} className="text-amber-500 shrink-0" />
                    <div>
                      <h5 className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Alerte Sécurité - Espace Administratif</h5>
                      <p className="text-[9px] text-amber-500 font-bold mt-1">Aucun mot de passe global n'a été configuré pour l'Espace Administratif commun.</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setShowSetGlobalGedPasscodeModal(true);
                      setGlobalGedPasscodeInput('');
                      setGlobalGedPasscodeConfirm('');
                      setGlobalGedPasscodeError('');
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-black text-[9px] uppercase tracking-wider rounded-xl transition-all shadow-sm shrink-0"
                  >
                    Configurer code
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Inside Space Screen */
        <div className="flex-1 flex flex-col bg-white rounded-[2.5rem] border border-gray-100 shadow-2xl overflow-hidden min-h-0">
          {/* Path Header & Search filter row */}
          <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
            {/* Breadcrumbs navigation */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-widest">
              {user.role !== 'contributor' && (
                <>
                  <button 
                    onClick={() => { setCurrentSpace(null); setShowTrash(false); }}
                    className="text-gray-400 hover:text-primary transition-colors flex items-center gap-1"
                  >
                    GED Accueil
                  </button>
                  <ChevronRight size={14} className="text-gray-300" />
                </>
              )}
              <button 
                onClick={() => { handleBreadcrumbClick(-1); setShowTrash(false); }}
                className={cn("hover:text-primary transition-colors", currentFolderId === null && !showTrash ? "text-primary font-black" : "text-gray-400")}
              >
                {currentSpace === 'private' ? 'Espace Privé' : currentSpace === 'administrative' ? 'Espace Administratif' : 'Gestion des dossiers'}
              </button>
              
              {!showTrash && breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  <ChevronRight size={14} className="text-gray-300" />
                  <button 
                    onClick={() => handleBreadcrumbClick(idx)}
                    className={cn("hover:text-primary transition-colors", idx === breadcrumbs.length - 1 ? "text-primary font-black" : "text-gray-400")}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}

              {showTrash && (
                <>
                  <ChevronRight size={14} className="text-gray-300" />
                  <span className="text-red-600 font-black">Corbeille de Rétention</span>
                </>
              )}
            </div>

            {/* Local workspace search input filter */}
            <div className="relative w-full md:w-80 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors" size={16} />
              <input 
                placeholder="Filtrer par nom..." 
                className="w-full pl-10 pr-6 py-3 bg-white border border-gray-100 rounded-2xl outline-none text-xs font-bold focus:ring-4 focus:ring-primary/5 transition-all shadow-sm"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Directory Content List */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 opacity-40">
                <RefreshCw size={40} className="animate-spin text-primary mb-4" />
                <p className="text-xs font-black uppercase tracking-widest">Synchronisation des coffres...</p>
              </div>
            ) : getVisibleItems().length === 0 ? (
              /* "Ce dossier est vide" with fast action buttons fallback code */
              <div className="flex flex-col items-center justify-center py-20 max-w-sm mx-auto text-center">
                <div className="w-16 h-16 bg-gray-50 text-gray-400 border border-gray-100 rounded-[1.5rem] flex items-center justify-center mb-6 shadow-inner text-xl">
                  {showTrash ? '🗑️' : '📂'}
                </div>
                <h3 className="text-base font-black text-[#2C3E50] uppercase tracking-tight mb-2">
                  {showTrash ? 'La corbeille est vide' : 'Ce dossier est vide'}
                </h3>
                <p className="text-xs text-gray-400 mb-8 leading-relaxed">
                  {showTrash 
                    ? "Les documents jetés expireront et seront supprimés définitivement après un délai de 30 jours réglementaire." 
                    : "Aucun document n'est présent dans ce répertoire. Utilisez les boutons d'accès rapide ci-dessous."
                  }
                </p>

                {!showTrash && (
                  <div className="flex flex-col sm:flex-row gap-3 w-full">
                    <label className="flex-1 px-4 py-3 bg-primary text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2 cursor-pointer">
                      <UploadCloud size={14} /> Téléverser un document
                      <input type="file" className="hidden" onChange={handleFileUpload} />
                    </label>
                    <button 
                      onClick={() => setShowScanner(true)}
                      className="flex-1 px-4 py-3 bg-[#0284C7] hover:bg-[#0369A1] text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-sky-600/15 flex items-center justify-center gap-2"
                    >
                      <Camera size={14} /> Numériser un document
                    </button>
                    <button 
                      onClick={() => setShowCreateFolder(true)}
                      className="flex-1 px-4 py-3 bg-white border border-gray-200 text-[#2C3E50] rounded-xl text-[9px] font-black uppercase tracking-widest hover:border-primary hover:text-primary transition-all shadow-sm flex items-center justify-center gap-2"
                    >
                      <Plus size={14} /> Créer un dossier
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* Grid / List render content */
              viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                  {getVisibleItems().map(item => {
                    const isGlobalLocked = item.isLocked && !unlockedGlobalItemIds.includes(item.id) && !isSuperUser;
                    return (
                      <div 
                        key={item.id}
                        onClick={() => {
                          if (showTrash) return;
                          if (item.type === 'folder') {
                            handleOpenFolder(item);
                          } else {
                            if (isGlobalLocked) {
                              setPromptLockItem(item);
                              setPromptLockValue('');
                              setPromptLockError('');
                            } else {
                              setPreviewItem(item);
                            }
                          }
                        }}
                        className={cn(
                          "bg-white border text-center p-6 rounded-[2rem] hover:shadow-xl hover:scale-[1.03] active:scale-95 transition-all relative cursor-pointer group flex flex-col justify-between aspect-square",
                          isGlobalLocked ? "border-amber-200 bg-amber-50/10" : "border-gray-100"
                        )}
                      >
                        {/* Lock overlay indicator */}
                        {isGlobalLocked && (
                          <div className="absolute top-4 left-4 p-1.5 bg-amber-500 text-white rounded-lg shadow-sm" title="Sécurisé par code administrateur">
                            <Lock size={10} />
                          </div>
                        )}

                        {/* Action menu '...' */}
                        <div className="absolute top-4 right-4" onClick={e => e.stopPropagation()}>
                          <button 
                            onClick={() => setActiveMenuId(activeMenuId === item.id ? null : item.id)}
                            className="p-1 text-gray-400 hover:text-primary rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <MoreVertical size={16} />
                          </button>
                          
                          {/* Row micro options panel drop menu */}
                          {activeMenuId === item.id && (
                            <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 text-left overflow-hidden py-1 animate-in zoom-in-95 duration-200">
                              {!showTrash ? (
                                <>
                                  <button onClick={() => { setShowRename(item); setRenameValue(item.name); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Edit size={12} /> Renommer</button>
                                  {user.role !== 'contributor' && currentSpace === 'administrative' && (
                                    <button onClick={() => { setShowLockSettingItem(item); setLockPasscodeInput(item.lockPasscode || ''); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2">
                                      {item.isLocked ? <Unlock size={12} /> : <Lock size={12} />} {item.isLocked ? "Retirer code" : "Sécuriser"}
                                    </button>
                                  )}
                                  <button onClick={() => { handleCopyTo(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Copy size={12} /> Copier vers</button>
                                  <button onClick={() => { handleMoveTo(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Move size={12} /> Déplacer vers</button>
                                  {item.type === 'file' && (
                                    <>
                                      <button onClick={() => { setPreviewItem(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-primary hover:bg-indigo-50 transition-all flex items-center gap-2"><Eye size={12} /> Visualiser</button>
                                      <a href={item.fileUrl} download={item.name} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Download size={12} /> Télécharger</a>
                                    </>
                                  )}
                                  <hr className="border-gray-100 my-1" />
                                  <button onClick={() => { triggerDeleteWithWarning(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-red-500 hover:bg-red-50 transition-all flex items-center gap-2"><Trash2 size={12} /> Supprimer</button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => { handleRestoreItem(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-green-600 hover:bg-green-50 transition-all flex items-center gap-2"><CheckCircle2 size={12} /> Restaurer</button>
                                  <button onClick={() => { handleHardDeleteItem(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-red-600 hover:bg-red-50 transition-all flex items-center gap-2"><Trash2 size={12} /> Purger</button>
                                </>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Large icon format */}
                        <div className="text-4xl my-auto text-center flex items-center justify-center">
                          {item.type === 'folder' ? '📂' : getFileIcon(item.extension)}
                        </div>

                        {/* Name and trace details */}
                        <div className="mt-4">
                          <p className="text-xs font-black text-[#2C3E50] truncate uppercase mb-1" title={item.name}>
                            {item.name}
                          </p>
                          <div className="flex flex-col gap-0.5" onClick={e => e.stopPropagation()}>
                            {/* Trace remains intact and visible even if agent has been deleted */}
                            <p className="text-[7px] text-gray-400 font-bold uppercase tracking-wider truncate">
                              Par : {item.createdBy?.firstName ? `${item.createdBy.firstName} ${item.createdBy.lastName}` : (item.createdBy?.displayName || 'DGI')}
                            </p>
                            <p className="text-[7px] text-gray-400 font-mono tracking-tighter">
                              Mat: {item.createdBy?.matricule || 'N/A'}
                            </p>
                            {item.isDeleted && item.deletedAt && (
                              <p className="text-[8px] text-red-500 font-black mt-1">
                                Expire sous {30 - Math.floor((Date.now() - (item.deletedAt.toMillis ? item.deletedAt.toMillis() : new Date(item.deletedAt).getTime())) / (24 * 60 * 60 * 1000))} j
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* List Layout View Row */
                <div className="bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm">
                  <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-gray-50/50 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                    <div className="col-span-5">Nom d'archivage / Type</div>
                    <div className="col-span-4">Agent Créateur (Traçabilité)</div>
                    <div className="col-span-2">Matricule</div>
                    <div className="col-span-1 text-right">Menu</div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {getVisibleItems().map(item => {
                      const isGlobalLocked = item.isLocked && !unlockedGlobalItemIds.includes(item.id) && !isSuperUser;
                      return (
                        <div 
                          key={item.id}
                          onClick={() => {
                            if (showTrash) return;
                            if (item.type === 'folder') {
                              handleOpenFolder(item);
                            } else {
                              if (isGlobalLocked) {
                                setPromptLockItem(item);
                                setPromptLockValue('');
                                setPromptLockError('');
                              } else {
                                setPreviewItem(item);
                              }
                            }
                          }}
                          className={cn(
                            "grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-gray-50/60 transition-all cursor-pointer",
                            isGlobalLocked && "bg-amber-50/10 hover:bg-amber-50/20"
                          )}
                        >
                          <div className="col-span-5 flex items-center gap-3">
                            <span className="text-xl shrink-0">
                              {item.type === 'folder' ? '📂' : getFileIcon(item.extension)}
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-black text-[#2C3E50] uppercase truncate flex items-center gap-2">
                                {item.name}
                                {isGlobalLocked && <Lock size={10} className="text-amber-500 shrink-0" />}
                              </p>
                              {item.fileSize && (
                                <p className="text-[8px] text-gray-400 font-mono">{(item.fileSize / 1024).toFixed(1)} Ko</p>
                              )}
                            </div>
                          </div>

                          <div className="col-span-4 min-w-0 text-xs text-gray-400 font-bold uppercase truncate">
                            {item.createdBy?.firstName ? `${item.createdBy.firstName} ${item.createdBy.lastName}` : (item.createdBy?.displayName || 'DGI')}
                          </div>

                          <div className="col-span-2 font-mono text-xs text-cyan-800">
                            {item.createdBy?.matricule || 'N/A'}
                          </div>

                          <div className="col-span-1 text-right relative" onClick={e => e.stopPropagation()}>
                            <button 
                              onClick={() => setActiveMenuId(activeMenuId === item.id ? null : item.id)}
                              className="p-1.5 text-gray-400 hover:text-primary rounded-lg hover:bg-gray-50"
                            >
                              <MoreVertical size={14} />
                            </button>
                            {/* Panel list menu */}
                            {activeMenuId === item.id && (
                              <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 text-left overflow-hidden py-1">
                                {!showTrash ? (
                                  <>
                                    <button onClick={() => { setShowRename(item); setRenameValue(item.name); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Edit size={12} /> Renommer</button>
                                    {user.role !== 'contributor' && currentSpace === 'administrative' && (
                                      <button onClick={() => { setShowLockSettingItem(item); setLockPasscodeInput(item.lockPasscode || ''); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2">
                                        {item.isLocked ? <Unlock size={12} /> : <Lock size={12} />} {item.isLocked ? "Retirer code" : "Sécuriser"}
                                      </button>
                                    )}
                                    <button onClick={() => { handleCopyTo(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Copy size={12} /> Copier vers</button>
                                    <button onClick={() => { handleMoveTo(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Move size={12} /> Déplacer vers</button>
                                    {item.type === 'file' && (
                                      <>
                                        <button onClick={() => { setPreviewItem(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-primary hover:bg-indigo-50 transition-all flex items-center gap-2"><Eye size={12} /> Visualiser</button>
                                        <a href={item.fileUrl} download={item.name} className="w-full px-4 py-2 text-[10px] font-black uppercase text-gray-500 hover:bg-gray-50 hover:text-primary transition-all flex items-center gap-2"><Download size={12} /> Télécharger</a>
                                      </>
                                    )}
                                    <hr className="border-gray-100 my-1" />
                                    <button onClick={() => { triggerDeleteWithWarning(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-red-500 hover:bg-red-50 transition-all flex items-center gap-2"><Trash2 size={12} /> Supprimer</button>
                                  </>
                                ) : (
                                  <>
                                    <button onClick={() => { handleRestoreItem(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-green-600 hover:bg-green-50 transition-all flex items-center gap-2"><CheckCircle2 size={12} /> Restaurer</button>
                                    <button onClick={() => { handleHardDeleteItem(item); setActiveMenuId(null); }} className="w-full px-4 py-2 text-[10px] font-black uppercase text-red-600 hover:bg-red-50 transition-all flex items-center gap-2"><Trash2 size={12} /> Purger</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* MODAL: Set Private passcode lock */}
      {showSetPrivatePasscode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Sécuriser l'Espace Privé</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Ce mot de passe personnel sera exigé à chaque ouverture de votre silo Espace Privé GED.
            </p>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest pl-1">Entrer un code secret</label>
                <input 
                  type="password"
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                  value={privatePasscodeInput}
                  onChange={e => setPrivatePasscodeInput(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest pl-1">Confirmer le code secret</label>
                <input 
                  type="password"
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                  value={privatePasscodeConfirm}
                  onChange={e => setPrivatePasscodeConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {privatePasscodeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide">{privatePasscodeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowSetPrivatePasscode(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Fermer
                </button>
                <button 
                  onClick={handleSetPrivatePasscode}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Verrouiller
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Prompt passcode lock Private */}
      {enterPrivatePasscode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Déverrouillage Espace Privé</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Veuillez saisir votre code d'accès personnel pour libérer l'accès aux dossiers du coffre.
            </p>
            <div className="space-y-4">
              <input 
                type="password"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center tracking-[1em]"
                value={verifyPrivatePasscodeVal}
                onChange={e => setVerifyPrivatePasscodeVal(e.target.value)}
                placeholder="••••"
                onKeyDown={e => e.key === 'Enter' && handleVerifyPrivatePasscode()}
              />

              {verifyPrivateError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide text-center">{verifyPrivateError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setEnterPrivatePasscode(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Retour
                </button>
                <button 
                  onClick={handleVerifyPrivatePasscode}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Entrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GED Security Settings */}
      {showGedSettings && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-lg w-full border border-white">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 text-[#2C3E50] rounded-xl">
                  <ShieldCheck size={20} className="text-indigo-600" />
                </div>
                <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight">Sécurité de la GED</h2>
              </div>
              <button onClick={() => setShowGedSettings(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg"><X size={18} /></button>
            </div>

            <div className="space-y-6 divide-y divide-gray-100">
              {/* Espace Privé Section */}
              <div className="pt-2">
                <h3 className="text-xs font-black text-indigo-900 uppercase tracking-wider mb-2">Configurez votre Espace Privé</h3>
                {user.gedPasscode ? (
                  <div className="space-y-3">
                    <p className="text-xs text-green-600 font-bold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                      Le code de verrouillage de votre Espace Privé est activé.
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setPromptCheckCurrentCode({ target: 'disable_private' });
                          setCheckCurrentCodeVal('');
                          setCheckCurrentCodeError('');
                          setShowGedSettings(false);
                        }}
                        className="px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 font-black text-[9px] uppercase tracking-wider rounded-xl transition-all"
                      >
                        Passer en Accès Libre
                      </button>
                      <button 
                        onClick={() => {
                          setPromptCheckCurrentCode({ target: 'change_private' });
                          setCheckCurrentCodeVal('');
                          setCheckCurrentCodeError('');
                          setShowGedSettings(false);
                        }}
                        className="px-4 py-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 font-black text-[9px] uppercase tracking-wider rounded-xl transition-all"
                      >
                        Changer le Code
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-400 leading-relaxed">
                      Votre Espace Privé est actuellement en accès libre (non sécurisé).
                    </p>
                    <button 
                      onClick={() => {
                        setShowSetPrivatePasscode(true);
                        setPrivatePasscodeInput('');
                        setPrivatePasscodeConfirm('');
                        setPrivatePasscodeError('');
                        setShowGedSettings(false);
                      }}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[9px] uppercase tracking-wider rounded-xl transition-all"
                    >
                      Définir code d'accès
                    </button>
                  </div>
                )}
              </div>

              {/* Espace Administratif Section (only displayed for Admin / SuperUser) */}
              {(isSuperUser || user.role === 'admin') && (
                <div className="pt-6">
                  <h3 className="text-xs font-black text-emerald-950 uppercase tracking-wider mb-2">Espace Administratif Commun</h3>
                  {globalGedPasscode ? (
                    <div className="space-y-3">
                      <p className="text-xs text-green-600 font-bold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        Le verrouillage de direction (Code Commun) est activé.
                      </p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            setPromptCheckCurrentCode({ target: 'disable_administrative' });
                            setCheckCurrentCodeVal('');
                            setCheckCurrentCodeError('');
                            setShowGedSettings(false);
                          }}
                          className="px-4 py-2 bg-red-50 text-red-600 hover:bg-red-100 font-black text-[9px] uppercase tracking-wider rounded-xl transition-all"
                        >
                          Désactiver le Verrou
                        </button>
                        <button 
                          onClick={() => {
                            setPromptCheckCurrentCode({ target: 'change_administrative' });
                            setCheckCurrentCodeVal('');
                            setCheckCurrentCodeError('');
                            setShowGedSettings(false);
                          }}
                          className="px-4 py-2 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-black text-[9px] uppercase tracking-wider rounded-xl transition-all"
                        >
                          Modifier le Code Global
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-400 leading-relaxed">
                        L'Espace Administratif commun est actuellement ouvert sans restrictions de code globales.
                      </p>
                      <button 
                        onClick={() => {
                          setShowSetGlobalGedPasscodeModal(true);
                          setGlobalGedPasscodeInput('');
                          setGlobalGedPasscodeConfirm('');
                          setGlobalGedPasscodeError('');
                          setShowGedSettings(false);
                        }}
                        className="px-4 py-2 bg-emerald-650 hover:bg-emerald-700 bg-emerald-600 text-white font-black text-[9px] uppercase tracking-wider rounded-xl transition-all"
                      >
                        Configurer Verrou Global de Direction
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Saisir code actuel pour valider la désactivation ou la modification */}
      {promptCheckCurrentCode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-sm w-full border border-white">
            <h2 className="text-base font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Validation requise</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Pour pouvoir désactiver ce verrou ou en modifier les paramètres, vous devez préalablement saisir votre code secret actuel.
            </p>
            <div className="space-y-4">
              <input 
                type="password"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center tracking-[0.5em]"
                value={checkCurrentCodeVal}
                onChange={e => setCheckCurrentCodeVal(e.target.value)}
                placeholder="••••"
                onKeyDown={e => e.key === 'Enter' && handleVerifyCurrentCodeBeforeAction()}
              />

              {checkCurrentCodeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide text-center">{checkCurrentCodeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setPromptCheckCurrentCode(null)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleVerifyCurrentCodeBeforeAction}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Set Collective Administrative Passcode */}
      {showSetGlobalGedPasscodeModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center text-emerald-950">Verrou de Direction Commun</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Définissez le mot de passe de direction pour l'accès de l'Espace Administratif commun.
            </p>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest pl-1">Saisir le mot de passe</label>
                <input 
                  type="password"
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                  value={globalGedPasscodeInput}
                  onChange={e => setGlobalGedPasscodeInput(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest pl-1">Confirmer le mot de passe</label>
                <input 
                  type="password"
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                  value={globalGedPasscodeConfirm}
                  onChange={e => setGlobalGedPasscodeConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {globalGedPasscodeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide">{globalGedPasscodeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowSetGlobalGedPasscodeModal(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Fermer
                </button>
                <button 
                  onClick={handleSetGlobalGedPasscode}
                  className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-green-500/20 active:scale-95 transition-all"
                >
                  Verrouiller
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verify Administrative space-level global passcode */}
      {enterAdministrativePasscode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-sm w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Habilitation Requise</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Veuillez saisir le mot de passe de verrouillage général de la direction pour libérer l'accès.
            </p>
            <div className="space-y-4">
              <input 
                type="password"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center tracking-[0.5em]"
                value={verifyAdministrativePasscodeVal}
                onChange={e => setVerifyAdministrativePasscodeVal(e.target.value)}
                placeholder="••••••••"
                onKeyDown={e => e.key === 'Enter' && handleVerifyAdministrativePasscode()}
              />

              {verifyAdministrativeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide text-center">{verifyAdministrativeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setEnterAdministrativePasscode(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Retour
                </button>
                <button 
                  onClick={handleVerifyAdministrativePasscode}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Setup global passcode lock on item */}
      {showLockSettingItem && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Passcode Administratif</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Définissez un mot de passe global pour sécuriser ce répertoire ou ce fichier spécifique. Laissez le champ vide pour retirer le verrouillage.
            </p>
            <div className="space-y-4">
              <input 
                type="text"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center"
                value={lockPasscodeInput}
                onChange={e => setLockPasscodeInput(e.target.value)}
                placeholder="Entrer le code de restriction global"
              />

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowLockSettingItem(null)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleApplyLockOnItem}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verify global passcode on item access */}
      {promptLockItem && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Coffre Sécurisé</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Ce dossier ou document administratif est verrouillé par un mot de passe administrateur spécifique.
            </p>
            <div className="space-y-4">
              <input 
                type="password"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center"
                value={promptLockValue}
                onChange={e => setPromptLockValue(e.target.value)}
                placeholder="Saisir le code d'accès global"
                onKeyDown={e => e.key === 'Enter' && handleVerifyGlobalLock()}
              />

              {promptLockError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide text-center">{promptLockError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setPromptLockItem(null)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Fermer
                </button>
                <button 
                  onClick={handleVerifyGlobalLock}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Déverrouiller
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Create Folder */}
      {showCreateFolder && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Nouveau Dossier GED</h2>
            <div className="space-y-4">
              <input 
                type="text"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                placeholder="Ex: Exercice 2026"
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
              />

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowCreateFolder(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleCreateFolder}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Créer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Rename Folder / File */}
      {showRename && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Renommer l'Elément</h2>
            <div className="space-y-4">
              <input 
                type="text"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                placeholder="Saisir le nouveau nom"
                onKeyDown={e => e.key === 'Enter' && handleRenameItem()}
              />

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowRename(null)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleRenameItem}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Renommer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Soft Delete (Trash) Warning */}
      {trashWarning && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-inner text-2xl">
              ⚠️
            </div>
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Déplacer dans la corbeille</h2>
            <p className="text-xs text-gray-400 mb-8 text-center leading-relaxed">
              Ce fichier/dossier va être déplacé dans la corbeille pendant 30 jours avant sa suppression définitive.
            </p>
            <div className="flex gap-4 pt-4">
              <button 
                onClick={() => setTrashWarning(null)}
                className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
              >
                Conserver
              </button>
              <button 
                onClick={() => handleSoftDelete(trashWarning)}
                className="flex-1 py-4 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-red-500/20 active:scale-95 transition-all"
              >
                Purger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: File Preview Viewer */}
      {previewItem && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-gray-900/80 backdrop-blur-md p-2 md:p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl max-w-7xl w-full h-[90vh] border border-white flex flex-col overflow-hidden animate-in zoom-in duration-300">
            
            {/* Modal Header */}
            <div className="p-5 md:p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{getFileIcon(previewItem.extension)}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-[#2C3E50] uppercase truncate max-w-[200px] md:max-w-md">{previewItem.name}</h3>
                    <span className={cn(
                      "px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.05em]",
                      (previewItem.status || 'Nouveau') === 'Nouveau' && 'bg-blue-50 text-blue-700 border border-blue-100',
                      (previewItem.status || 'Nouveau') === 'En cours' && 'bg-amber-50 text-amber-700 border border-amber-100',
                      ((previewItem.status || 'Nouveau') === 'Terminé' || (previewItem.status || 'Nouveau') === 'Terminé / Envoyé') && 'bg-green-50 text-green-700 border border-green-100',
                      (previewItem.status || 'Nouveau') === 'Archivé' && 'bg-gray-100 text-gray-700 border border-gray-200'
                    )}>
                      {previewItem.status === 'Terminé' ? 'Terminé / Envoyé' : (previewItem.status || 'Nouveau')}
                    </span>
                  </div>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                    ID Dossier #GED-{previewItem.id?.slice(0,8).toUpperCase()} • Créateur : {previewItem.createdBy?.displayName || 'DGI'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a 
                  href={selectedPreviewVersion && previewItem.versions ? (previewItem.versions.find(v => v.version === selectedPreviewVersion)?.fileUrl || previewItem.fileUrl) : previewItem.fileUrl} 
                  download={previewItem.name}
                  className="p-3 bg-primary text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:brightness-110 flex items-center gap-1.5"
                  title="Télécharger l'original"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">Télécharger</span>
                </a>
                <button 
                  onClick={() => {
                    setPreviewItem(null);
                    setSelectedPreviewVersion(null);
                  }}
                  className="p-3 bg-gray-100 text-gray-500 hover:text-red-500 rounded-2xl cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Split view content: Left (Preview Box), Right (Dossier Suite Sidebar) */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-gray-50">
              
              {/* Left Column: Deep frame previewer */}
              <div className="flex-1 bg-zinc-950 p-4 md:p-6 flex flex-col items-center justify-center relative overflow-hidden select-none border-r border-gray-100 h-[40vh] lg:h-auto overflow-y-auto">
                <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm px-3.5 py-1.5 rounded-full z-10 text-[9px] font-black uppercase tracking-[0.1em] text-neutral-300 border border-white/15">
                  Aperçu : {selectedPreviewVersion ? `Version V${selectedPreviewVersion}` : 'Image d\'origine'}
                </div>

                {['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(previewItem.extension?.toLowerCase() || '') ? (
                  <img 
                    src={selectedPreviewVersion && previewItem.versions ? (previewItem.versions.find(v => v.version === selectedPreviewVersion)?.fileUrl || previewItem.fileUrl) : previewItem.fileUrl} 
                    className="max-h-full max-w-full object-contain rounded-2xl select-none" 
                    alt={previewItem.name} 
                    referrerPolicy="no-referrer"
                  />
                ) : previewItem.extension?.toLowerCase() === 'pdf' ? (
                  <iframe 
                    src={selectedPreviewVersion && previewItem.versions ? (previewItem.versions.find(v => v.version === selectedPreviewVersion)?.fileUrl || previewItem.fileUrl) : previewItem.fileUrl}
                    className="w-full h-full bg-white rounded-2xl shadow-xl min-h-[400px]"
                    title={previewItem.name}
                  />
                ) : (
                  <div className="bg-white p-8 rounded-[2.5rem] max-w-sm w-full text-center border shadow-2xl">
                    <div className="text-5xl mb-4 flex justify-center">{getFileIcon(previewItem.extension)}</div>
                    <h4 className="text-base font-black text-[#2C3E50] uppercase mb-1 truncate">{previewItem.name}</h4>
                    <p className="text-xs text-gray-400 mb-6">
                      Le format de ce fichier (.{(previewItem.extension || '').toUpperCase()}) ne supporte pas l'aperçu instantané en ligne.
                    </p>
                    <a 
                      href={previewItem.fileUrl} 
                      download={previewItem.name}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-lg"
                    >
                      <Download size={12} /> Télécharger
                    </a>
                  </div>
                )}
              </div>

              {/* Right Column: Life-Cycle control dashboard workspace */}
              <div className="w-full lg:w-[420px] bg-white flex flex-col overflow-y-auto border-l border-gray-100 p-5 md:p-6 gap-6 custom-scrollbar">
                
                {/* 1. STATUS TRANSITION PANEL */}
                <div className="bg-gray-50/50 p-4 rounded-3xl border border-gray-100/80">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Statut & Étape de Traitement</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {(['Nouveau', 'En cours', 'Terminé / Envoyé', 'Archivé'] as const).map((st) => {
                      const isActive = st === 'Terminé / Envoyé'
                        ? ((previewItem.status || 'Nouveau') === 'Terminé / Envoyé' || (previewItem.status || 'Nouveau') === 'Terminé')
                        : (previewItem.status || 'Nouveau') === st;
                      return (
                        <button
                          key={st}
                          onClick={() => handleUpdateStatus(previewItem.id, st)}
                          className={cn(
                            "py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border text-center flex items-center justify-center gap-1.5 cursor-pointer",
                            isActive 
                              ? st === 'Nouveau' ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/10' :
                                st === 'En cours' ? 'bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/10' :
                                st === 'Terminé / Envoyé' ? 'bg-green-600 text-white border-green-600 shadow-md shadow-green-600/10' :
                                'bg-gray-600 text-white border-gray-600 shadow-md shadow-gray-400/10'
                              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                          )}
                        >
                          {isActive && <div className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />}
                          {st}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 1.1 LINKED CONVERSATION PANEL */}
                {user?.role !== 'contributor' && (
                  <div className="bg-gray-50/50 p-4 rounded-3xl border border-gray-100/80">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Liaison de Conversation Contribuable</h4>
                    
                    {previewItem.linkedConversationId ? (
                      (() => {
                        const linkedConv = conversations.find(c => c.id === previewItem.linkedConversationId);
                        return (
                          <div className="bg-white p-3 rounded-2xl border border-teal-100 flex flex-col gap-2">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-[#2C3E50]">Dossier Lié Activement</span>
                              </div>
                              <button 
                                onClick={() => handleUnlinkFromConversation(previewItem.id)}
                                className="text-[9px] font-black uppercase tracking-widest text-red-500 hover:text-red-700 cursor-pointer"
                              >
                                Détacher
                              </button>
                            </div>
                            
                            <div className="text-xs text-gray-700 font-medium">
                              {linkedConv ? (
                                <>
                                  <p className="font-extrabold text-gray-900">{linkedConv.contributorName || linkedConv.companyName || 'Contribuable Inconnu'}</p>
                                  <p className="text-gray-500 text-[10px] truncate">Sujet : {linkedConv.subject}</p>
                                  <p className="text-gray-400 text-[9px] font-mono mt-1">ID Conv: #{linkedConv.id.slice(0, 8).toUpperCase()}</p>
                                </>
                              ) : (
                                <p className="text-amber-600 font-bold">Liaison active (ID conversation: {previewItem.linkedConversationId.slice(0, 8).toUpperCase()})</p>
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] text-gray-400">Associez ce document administratif à un fil de discussion d'un contribuable pour automatiser notifications et clôtures.</p>
                        
                        <div className="relative">
                          <input 
                            type="text" 
                            placeholder="Rechercher un contribuable ou sujet..." 
                            value={linkingSearch}
                            onChange={(e) => setLinkingSearch(e.target.value)}
                            className="w-full px-3 py-1.5 pr-8 bg-white border border-gray-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                          />
                          <Search size={14} className="absolute right-2.5 top-2.5 text-gray-400" />
                        </div>
                        
                        <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto custom-scrollbar mt-1 bg-white rounded-2xl border border-gray-100 p-1.5">
                          {conversations
                            .filter(conv => {
                              const searchLower = linkingSearch.toLowerCase();
                              return (
                                (conv.contributorName?.toLowerCase() || '').includes(searchLower) ||
                                (conv.companyName?.toLowerCase() || '').includes(searchLower) ||
                                (conv.subject?.toLowerCase() || '').includes(searchLower)
                              );
                            })
                            .map(conv => (
                              <button
                                key={conv.id}
                                onClick={() => handleLinkToConversation(previewItem.id, conv.id)}
                                className="w-full text-left p-2 hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-100 flex flex-col text-xs cursor-pointer"
                              >
                                <span className="font-bold text-gray-800 truncate">
                                  {conv.contributorName || conv.companyName || 'Contribuable'}
                                </span>
                                <span className="text-[10px] text-gray-400 truncate">
                                  {conv.subject}
                                </span>
                              </button>
                            ))}
                          {conversations.filter(conv => {
                            const searchLower = linkingSearch.toLowerCase();
                            return (
                              (conv.contributorName?.toLowerCase() || '').includes(searchLower) ||
                              (conv.companyName?.toLowerCase() || '').includes(searchLower) ||
                              (conv.subject?.toLowerCase() || '').includes(searchLower)
                            );
                          }).length === 0 && (
                            <p className="text-center py-4 text-[10px] font-bold text-gray-400">Aucune conversation active trouvée</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. PERSISTENT HISTORICAL VERSIONS */}
                <div className="bg-gray-50/50 p-4 rounded-3xl border border-gray-100/80">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Historique des Versions</h4>
                  <div className="flex flex-col gap-2">
                    {/* Source / V0 */}
                    <button
                      onClick={() => setSelectedPreviewVersion(null)}
                      className={cn(
                        "w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer",
                        selectedPreviewVersion === null ? 'bg-primary/5 border-primary/20 ring-1 ring-primary' : 'bg-white border-gray-100 hover:bg-gray-50'
                      )}
                    >
                      <div>
                        <p className="text-xs font-black text-[#2C3E50]">Document original (V0)</p>
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">Source d'entrée numérisée</p>
                      </div>
                      <span className="text-[9px] font-black px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md">Original</span>
                    </button>

                    {/* Versions arrays */}
                    {previewItem.versions?.map((ver) => (
                      <button
                        key={ver.version}
                        onClick={() => setSelectedPreviewVersion(ver.version)}
                        className={cn(
                          "w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer",
                          selectedPreviewVersion === ver.version ? 'bg-primary/5 border-primary/20 ring-1 ring-primary' : 'bg-white border-gray-100 hover:bg-gray-50'
                        )}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-black text-[#2C3E50]">Version {ver.version}</p>
                            {ver.hasSignature && <span className="text-[8px] bg-slate-100 text-slate-800 font-bold px-1 py-0.2 rounded">Signé</span>}
                            {ver.hasStamp && <span className="text-[8px] bg-cyan-100 text-cyan-800 font-bold px-1 py-0.2 rounded">Cacheté</span>}
                          </div>
                          <p className="text-[9px] text-gray-400 truncate max-w-[240px] italic">"{ver.annotation}"</p>
                        </div>
                        <span className="text-[9px] text-gray-400 font-bold">V{ver.version}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. SIGNATURE & STAMP COLLABORATIVE UPLOAD VERSION */}
                <div className="bg-gray-50/50 p-4 rounded-3xl border border-gray-100/80">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Viser, Signer & Publier une Nouvelle Version</h4>
                  <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
                    Ajoutez une annotation ou appliquez directement vos éléments d'authentification enregistrés pour sceller cette nouvelle version.
                  </p>

                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      {/* Signature check */}
                      <label className={cn(
                        "flex-1 items-center gap-2 p-2 rounded-xl border flex cursor-pointer select-none text-[10px] font-bold uppercase justify-center",
                        applySignatureOnVersion ? 'bg-teal-55 border-teal-200 text-teal-800 font-black' : 'bg-white border-gray-100 text-gray-450',
                        !user?.signatureUrl && 'opacity-30 cursor-not-allowed'
                      )}>
                        <input 
                          type="checkbox"
                          disabled={!user?.signatureUrl}
                          checked={applySignatureOnVersion}
                          onChange={(e) => setApplySignatureOnVersion(e.target.checked)}
                          className="accent-teal-600 rounded"
                        />
                        Signature ✍️
                      </label>

                      {/* Stamp check */}
                      <label className={cn(
                        "flex-1 items-center gap-2 p-2 rounded-xl border flex cursor-pointer select-none text-[10px] font-bold uppercase justify-center",
                        applyStampOnVersion ? 'bg-amber-55 border-amber-200 text-amber-800 font-black' : 'bg-white border-gray-100 text-gray-450',
                        !user?.stampUrl && 'opacity-30 cursor-not-allowed'
                      )}>
                        <input 
                          type="checkbox"
                          disabled={!user?.stampUrl}
                          checked={applyStampOnVersion}
                          onChange={(e) => setApplyStampOnVersion(e.target.checked)}
                          className="accent-amber-600 rounded"
                        />
                        Cachet 🏢
                      </label>
                    </div>

                    {!user?.signatureUrl && !user?.stampUrl && (
                      <p className="text-[9px] text-red-500 font-medium leading-tight">
                        ⚠️ Rendez-vous dans votre Profil pour téléverser & détourer votre signature/cachet afin d'activer ces options d'authentification officielle.
                      </p>
                    )}

                    <div>
                      <input 
                        type="text"
                        className="w-full px-3 py-2 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none shadow-sm focus:border-primary placeholder-gray-405"
                        placeholder="Annotation (ex: Validé pour transmission...)"
                        value={versionAnnotation}
                        onChange={(e) => setVersionAnnotation(e.target.value)}
                      />
                    </div>

                    <label className={cn(
                      "w-full py-2.5 px-4 bg-[#2C3E50] text-white text-[10px] font-black uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all hover:bg-opacity-95 shadow-lg",
                      isUploadingVersion && 'opacity-50 pointer-events-none'
                    )}>
                      {isUploadingVersion ? <Loader2 className="animate-spin text-white" size={14} /> : <CheckCircle2 size={14} />}
                      {isUploadingVersion ? 'Traitement...' : 'Publier nouvelle version'}
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleUploadNewVersion}
                        disabled={isUploadingVersion}
                      />
                    </label>
                  </div>
                </div>

                {/* 4. IMMUTABLE CHRONOLOGICAL LOGS & DISCUSSION THREAD */}
                <div className="flex-1 min-h-[200px] flex flex-col border border-gray-150 rounded-3xl overflow-hidden bg-gray-50/20">
                  <div className="p-3 bg-gray-100/60 border-b border-gray-150 flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-[#2C3E50] uppercase tracking-wider">Discussion & Historique Inviolable</h4>
                    <span className="text-[8px] font-black bg-emerald-110 text-emerald-800 uppercase px-1.5 py-0.5 rounded">Scellé</span>
                  </div>

                  {/* Logs stream timeline list */}
                  <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[220px] custom-scrollbar">
                    
                    {/* Default initial create audit trail if logs are blank */}
                    <div className="relative pl-6 pb-2 border-l border-dashed border-gray-200">
                      <div className="absolute -left-1.5 top-1.5 w-3 h-3 bg-blue-600 rounded-full border border-white shadow shadow-blue-500/20" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[10px] font-black text-[#2C3E50]">{previewItem.createdBy?.displayName || 'DGI'}</p>
                          <span className="text-[8px] bg-blue-50 text-blue-800 font-bold px-1 rounded uppercase">Création</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Numérisation et création du dossier initial.</p>
                        <p className="text-[8px] text-gray-400 mt-1 font-mono">
                          {previewItem.createdAt ? (previewItem.createdAt as any).toDate ? (previewItem.createdAt as any).toDate().toLocaleString() : new Date().toLocaleString() : ''}
                        </p>
                      </div>
                    </div>

                    {/* Timeline elements */}
                    {previewItem.historyLogs?.map((log) => (
                      <div key={log.id} className="relative pl-6 pb-2 border-l border-dashed border-gray-200 select-text">
                        <div className={cn(
                          "absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border border-white shadow",
                          log.action === 'CHANGEMENT_STATUT' ? 'bg-amber-500' :
                          log.action === 'VERSION_AJOUTE' ? 'bg-sky-500' : 'bg-gray-400'
                        )} />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-[10px] font-black text-[#2C3E50]">{log.authorName}</p>
                            <span className="text-[8px] bg-gray-100 text-gray-600 px-1 rounded uppercase tracking-wide font-black">{log.authorRole}</span>
                          </div>
                          <p className="text-[10px] text-gray-650 mt-0.5 whitespace-pre-wrap leading-tight">{log.description}</p>
                          <p className="text-[8px] text-gray-400 mt-0.5 font-mono">{new Date(log.timestamp).toLocaleString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Comment Input */}
                  <div className="p-3 border-t border-gray-150 bg-white flex gap-2">
                    <input 
                      type="text" 
                      className="flex-1 px-3 py-2 border border-gray-100 rounded-xl text-xs font-bold outline-none bg-gray-50/50"
                      placeholder="Commentaire ou annotation..."
                      value={commentInput}
                      onChange={(e) => setCommentInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddComment(previewItem.id);
                      }}
                    />
                    <button 
                      onClick={() => handleAddComment(previewItem.id)}
                      className="px-3 py-2 bg-primary text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:brightness-115 cursor-pointer"
                    >
                      Poster
                    </button>
                  </div>
                </div>

              </div>

            </div>
          </div>
        </div>
      )}

      {/* MODAL: Set Global GED Passcode */}
      {showSetGlobalGedPasscodeModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white animate-in zoom-in duration-300">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Sécuriser l'Espace Administratif</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Ce mot de passe de direction global sera exigé de tous les agents pour accéder à l'Espace Administratif commun.
            </p>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest pl-1">Entrer un code global</label>
                <input 
                  type="password"
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                  value={globalGedPasscodeInput}
                  onChange={e => setGlobalGedPasscodeInput(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest pl-1">Confirmer le code global</label>
                <input 
                  type="password"
                  className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none"
                  value={globalGedPasscodeConfirm}
                  onChange={e => setGlobalGedPasscodeConfirm(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {globalGedPasscodeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide">{globalGedPasscodeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setShowSetGlobalGedPasscodeModal(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Fermer
                </button>
                <button 
                  onClick={handleSetGlobalGedPasscode}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Verrouiller
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Prompt passcode lock Administrative */}
      {enterAdministrativePasscode && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white animate-in zoom-in duration-300">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Déverrouillage Espace Administratif</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Veuillez saisir le code d'accès de la direction pour libérer l'accès aux dossiers administratifs.
            </p>
            <div className="space-y-4">
              <input 
                type="password"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center tracking-[1em]"
                value={verifyAdministrativePasscodeVal}
                onChange={e => setVerifyAdministrativePasscodeVal(e.target.value)}
                placeholder="••••"
                onKeyDown={e => e.key === 'Enter' && handleVerifyAdministrativePasscode()}
              />

              {verifyAdministrativeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide text-center">{verifyAdministrativeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setEnterAdministrativePasscode(false)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Retour
                </button>
                <button 
                  onClick={handleVerifyAdministrativePasscode}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Entrer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GED Settings */}
      {showGedSettings && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-xl w-full border border-white animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-primary/10 text-primary rounded-2xl shadow-inner">
                  <Settings size={22} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight">Paramètres GED</h2>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed">Sécurité & Privilèges d'accès</p>
                </div>
              </div>
              <button 
                onClick={() => setShowGedSettings(false)}
                className="p-2 bg-gray-50 rounded-xl hover:text-red-500 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6 animate-in fade-in slide-in-from-bottom duration-300">
              {/* Espace Privé Settings */}
              <div className="p-6 bg-gray-50/50 border border-gray-100 rounded-[2rem] space-y-4">
                <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
                  <UserCircle size={18} className="text-indigo-600" />
                  <h4 className="text-xs font-black text-[#2C3E50] uppercase tracking-wider">Sécurité Espace Privé</h4>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-black uppercase text-gray-400">Statut actuel</p>
                    <p className="text-xs font-bold text-gray-600 mt-1">
                      {user.gedPasscode ? "🔒 Activé — Silo crypté par code personnel" : "🔓 Désactivé — Accès direct sans code"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {user.gedPasscode ? (
                      <>
                        <button 
                          onClick={() => {
                            setPromptCheckCurrentCode({ target: 'disable_private' });
                            setCheckCurrentCodeVal('');
                            setCheckCurrentCodeError('');
                          }}
                          className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                        >
                          Désactiver
                        </button>
                        <button 
                          onClick={() => {
                            setPromptCheckCurrentCode({ target: 'change_private' });
                            setCheckCurrentCodeVal('');
                            setCheckCurrentCodeError('');
                          }}
                          className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                        >
                          Modifier
                        </button>
                      </>
                    ) : (
                      <button 
                        onClick={() => {
                          setShowSetPrivatePasscode(true);
                          setPrivatePasscodeInput('');
                          setPrivatePasscodeConfirm('');
                          setPrivatePasscodeError('');
                        }}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all shadow-md shadow-indigo-600/10"
                      >
                        Activer le verrouillage
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Espace Administratif Settings */}
              {(isSuperUser || user.role === 'admin') && (
                <div className="p-6 bg-gray-50/50 border border-gray-100 rounded-[2rem] space-y-4">
                  <div className="flex items-center gap-3 border-b border-gray-100 pb-3">
                    <ShieldCheck size={18} className="text-emerald-600" />
                    <h4 className="text-xs font-black text-[#2C3E50] uppercase tracking-wider">Sécurité Espace Administratif Commun</h4>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-black uppercase text-gray-400">Statut Direction</p>
                      <p className="text-xs font-bold text-gray-600 mt-1">
                        {globalGedPasscode ? "🔒 Activé — Protégé par mot de passe global de direction" : "🔓 Désactivé — Accès libre pour le staff"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {globalGedPasscode ? (
                        <>
                          <button 
                            onClick={() => {
                              setPromptCheckCurrentCode({ target: 'disable_administrative' });
                              setCheckCurrentCodeVal('');
                              setCheckCurrentCodeError('');
                            }}
                            className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                          >
                            Désactiver
                          </button>
                          <button 
                            onClick={() => {
                              setPromptCheckCurrentCode({ target: 'change_administrative' });
                              setCheckCurrentCodeVal('');
                              setCheckCurrentCodeError('');
                            }}
                            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[9px] font-black uppercase tracking-wider transition-all"
                          >
                            Modifier
                          </button>
                        </>
                      ) : (
                        <button 
                          onClick={() => {
                            setShowSetGlobalGedPasscodeModal(true);
                            setGlobalGedPasscodeInput('');
                            setGlobalGedPasscodeConfirm('');
                            setGlobalGedPasscodeError('');
                          }}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[9px] font-black uppercase tracking-wider transition-all shadow-md shadow-emerald-600/10"
                        >
                          Activer le verrouillage
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-4 pt-8 border-t border-gray-100 mt-8">
              <button 
                onClick={() => setShowGedSettings(false)}
                className="w-full py-4 bg-gray-100 hover:bg-gray-200 text-[#2C3E50] rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
              >
                Fermer Paramètres
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Verify Current Passcode Before Modifying/Deactivating */}
      {promptCheckCurrentCode && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-sm w-full border border-white animate-in zoom-in duration-300">
            <h2 className="text-xl font-black text-[#2C3E50] uppercase italic tracking-tight mb-4 text-center">Vérification de Sécurité</h2>
            <p className="text-xs text-gray-400 mb-6 text-center leading-relaxed">
              Pour des raisons de haute sécurité, veuillez confirmer votre code d'accès actuel avant d'appliquer ce changement.
            </p>
            <div className="space-y-4">
              <input 
                type="password"
                className="w-full px-5 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black shadow-inner outline-none text-center tracking-[1em]"
                value={checkCurrentCodeVal}
                onChange={e => setCheckCurrentCodeVal(e.target.value)}
                placeholder="••••"
                onKeyDown={e => e.key === 'Enter' && handleVerifyCurrentCodeBeforeAction()}
              />

              {checkCurrentCodeError && (
                <p className="text-[10px] text-red-600 font-bold uppercase tracking-wide text-center">{checkCurrentCodeError}</p>
              )}

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={() => setPromptCheckCurrentCode(null)}
                  className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                >
                  Annuler
                </button>
                <button 
                  onClick={handleVerifyCurrentCodeBeforeAction}
                  className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                >
                  Confirmer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showScanner && (
          <DocumentScanner 
            onClose={() => setShowScanner(false)} 
            onScanComplete={importScannedFileToGed} 
            title="Numériseur de Dossiers GED"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
