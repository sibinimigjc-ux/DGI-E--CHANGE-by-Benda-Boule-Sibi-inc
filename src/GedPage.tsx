import React, { useState, useEffect } from 'react';
import { 
  Folder, FolderPlus, UploadCloud, Trash2, MoreVertical, 
  Lock, Unlock, Settings, ChevronRight, ArrowLeft, 
  AlertCircle, Eye, Download, Edit, Copy, Move, 
  Clipboard, X, Key, CheckCircle2, UserCheck, RefreshCw,
  Search, FileText, Grid, List, Plus, ShieldCheck, HardDrive,
  UserCircle
} from 'lucide-react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDocs, or, and, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './lib/firebase';
import { useAuth, hasPermission } from './App';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GedItem, AppUser } from './types';

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

  // Global Admin locks for folders/files
  const [showLockSettingItem, setShowLockSettingItem] = useState<GedItem | null>(null);
  const [lockPasscodeInput, setLockPasscodeInput] = useState('');
  
  const [promptLockItem, setPromptLockItem] = useState<GedItem | null>(null);
  const [promptLockValue, setPromptLockValue] = useState('');
  const [promptLockError, setPromptLockError] = useState('');
  const [unlockedGlobalItemIds, setUnlockedGlobalItemIds] = useState<string[]>([]);

  // File Preview Modal
  const [previewItem, setPreviewItem] = useState<GedItem | null>(null);

  // Status & notifications
  const [statusText, setStatusText] = useState('');

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
      setCurrentSpace('administrative');
      setCurrentFolderId(null);
      setBreadcrumbs([]);
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
      return item.name.toLowerCase().includes(searchQuery.toLowerCase());
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              {/* Private Space Box */}
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
                  <h3 className="text-base font-black text-[#2C3E50] group-hover:text-primary transition-colors">Espace Administratif</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2 leading-relaxed">
                    Fichiers d'exercice légal de la DGI ou dossiers d'habilitation. Droits restreints par les administrateurs.
                  </p>
                </div>
              </button>
            </div>

            {/* Code Private passcode warning and secure tool inside prompt */}
            {!user.gedPasscode && !isSuperUser && (
              <div className="mt-8 p-4 bg-orange-50 border border-orange-100 rounded-2xl text-left flex items-center justify-between gap-4">
                <div className="flex gap-3">
                  <AlertCircle size={20} className="text-orange-500 shrink-0" />
                  <div>
                    <h5 className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Alerte Sécurité</h5>
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
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-black text-[9px] uppercase tracking-wider rounded-xl transition-all shadow-sm"
                >
                  Configurer code
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Inside Space Screen */
        <div className="flex-1 flex flex-col bg-white rounded-[2.5rem] border border-gray-100 shadow-2xl overflow-hidden min-h-0">
          {/* Path Header & Search filter row */}
          <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
            {/* Breadcrumbs navigation */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-widest">
              <button 
                onClick={() => { setCurrentSpace(null); setShowTrash(false); }}
                className="text-gray-400 hover:text-primary transition-colors flex items-center gap-1"
              >
                GED Accueil
              </button>
              <ChevronRight size={14} className="text-gray-300" />
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
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-gray-900/80 backdrop-blur-md p-4">
          <div className="bg-white rounded-[3.5rem] shadow-2xl max-w-4xl w-full h-[85vh] border border-white flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{getFileIcon(previewItem.extension)}</span>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-[#2C3E50] uppercase truncate max-w-[300px] md:max-w-xl">{previewItem.name}</h3>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
                    Par : {previewItem.createdBy?.displayName} • {(previewItem.fileSize ? (previewItem.fileSize / 1024).toFixed(1) : 0)} Ko
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a 
                  href={previewItem.fileUrl} 
                  download={previewItem.name}
                  className="p-3 bg-primary text-white rounded-2xl text-[9px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:brightness-110"
                  title="Télécharger l'original"
                >
                  <Download size={16} />
                </a>
                <button 
                  onClick={() => setPreviewItem(null)}
                  className="p-3 bg-gray-100 text-gray-500 hover:text-red-500 rounded-2xl"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal Content - Viewer box */}
            <div className="flex-1 bg-gray-900 p-6 flex items-center justify-center overflow-auto relative">
              {['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(previewItem.extension?.toLowerCase() || '') ? (
                <img 
                  src={previewItem.fileUrl} 
                  className="max-h-full max-w-full object-contain rounded-xl select-none" 
                  alt={previewItem.name} 
                  referrerPolicy="no-referrer"
                />
              ) : previewItem.extension?.toLowerCase() === 'pdf' ? (
                /* Dynamic standard sandboxed iframe embed for real PDFs! */
                <iframe 
                  src={previewItem.fileUrl}
                  className="w-full h-full bg-white rounded-2xl shadow-xl"
                  title={previewItem.name}
                />
              ) : (
                /* Other document types visual details card */
                <div className="bg-white p-10 rounded-[2.5rem] max-w-md w-full text-center border shadow-2xl">
                  <div className="text-5xl mb-6 flex justify-center">
                    {getFileIcon(previewItem.extension)}
                  </div>
                  <h4 className="text-base font-black text-[#2C3E50] uppercase mb-2 truncate">{previewItem.name}</h4>
                  <p className="text-xs text-gray-400 mb-8">
                    Le format de ce fichier (.{(previewItem.extension || '').toUpperCase()}) ne supporte pas l'aperçu instantané en ligne.
                  </p>
                  <a 
                    href={previewItem.fileUrl} 
                    download={previewItem.name}
                    className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-105 active:scale-95 transition-all"
                  >
                    <Download size={14} /> Télécharger pour l'ouvrir
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
