import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  useLocation,
  useNavigate
} from 'react-router-dom';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  signInWithEmailAndPassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  GoogleAuthProvider,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy,
  addDoc,
  limit,
  deleteDoc,
  deleteField,
  serverTimestamp,
  or,
  and,
  getDocs,
  writeBatch,
  arrayUnion,
  getDocFromServer
} from 'firebase/firestore';

import { auth, db, googleProvider, storage } from './lib/firebase';
import { motion } from 'motion/react';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL,
  uploadBytesResumable,
  deleteObject
} from 'firebase/storage';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous
    },
    operationType,
    path
  }
  console.error('[FIRESTORE_ERROR]', JSON.stringify(errInfo));
  // Not throwing to avoid crashing the whole tree, but logging is vital
}

// Test connection strictly from server once at boot
async function testConnection() {
  try {
    const start = Date.now();
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log(`Firebase Connection verified in ${Date.now() - start}ms`);
  } catch (error: any) {
    handleFirestoreError(error, OperationType.GET, 'test/connection');
  }
}

import * as Dialog from '@radix-ui/react-dialog';
import { AppUser, DEFAULT_THEME, ThemeConfig, Exchange, InternalMessage, Attachment, Conversation, Invitation, UserRole, AgentPermission } from './types';
import { 
  Building2, 
  Layout, 
  Mail, 
  Settings, 
  ShieldCheck, 
  Users, 
  Paperclip, 
  Send, 
  Search, 
  Menu,
  X, 
  RefreshCw, 
  Plus, 
  ChevronRight, 
  Layers, 
  MessageSquare, 
  UserCircle, 
  LogOut,
  Trash2,
  RefreshCcw,
  Shield,
  FileText,
  MapPin,
  Lock,
  Eye,
  EyeOff,
  UserX,
  UserPlus,
  Upload,
  UploadCloud,
  Download,
  ArrowRightLeft,
  CheckCircle2,
  ShieldAlert as ShieldLock,
  Zap,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  AlertTriangle,
  ExternalLink,
  Building,
  History,
  Info,
  ChevronDown,
  User,
  ArrowLeft,
  Camera,
  LogOut as ExitIcon,
  Briefcase,
  Hash,
  Maximize2,
  Image,
  AlertCircle,
  Phone,
  UserMinus,
  FileStack,
  Key
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import imageCompression from 'browser-image-compression';

const MASTER_ADMIN_CODE = 'Smiley2025';
const isMasterCodeValid = (pass: string) => {
  const p = pass.trim().toLowerCase();
  return p === 'smiley' || p === 'smiley2025';
};

// --- Utils ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function compressImage(file: File, maxWidth = 1200, quality = 0.7): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  
  const options = {
    maxSizeMB: 0.25, // Extreme optimization for high-speed reception
    maxWidthOrHeight: maxWidth,
    useWebWorker: true,
    initialQuality: 0.5,
    alwaysKeepAspectRatio: true
  };

  try {
    const compressedFile = await imageCompression(file, options);
    // Return a File object with previous metadata
    return new File([compressedFile], file.name, {
      type: file.type,
      lastModified: Date.now(),
    });
  } catch (error) {
    console.error('Compression failed', error);
    return file;
  }
}

async function compressBrandingImage(file: File, type: 'logo' | 'favicon'): Promise<File> {
  const targetSize = type === 'logo' ? 200 : 32;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new window.Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > targetSize) {
            height = Math.round((height * targetSize) / width);
            width = targetSize;
          }
        } else {
          if (height > targetSize) {
            width = Math.round((width * targetSize) / height);
            height = targetSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
        }

        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: 'image/png',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            reject(new Error('Canvas toBlob failed'));
          }
        }, 'image/png');
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

async function uploadFile(
  file: File, 
  path: string, 
  onProgress?: (p: number) => void, 
  onTask?: (task: any) => void,
  attempt = 0
): Promise<string> {
  const isMessage = path.includes('conversations') || path.includes('internal');
  if (onProgress && attempt === 0) onProgress(5);

  let fileToUpload = file;
  if (attempt === 0 && file.type.startsWith('image/')) {
    try {
      fileToUpload = await compressImage(file, 800, 0.5);
    } catch (e) {
      console.warn("Compression bypass", e);
    }
  }

  const folder = isMessage ? 'pieces_jointes' : path;
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
  const fileRef = ref(storage, `${folder}/${Date.now()}_${sanitizedName}`);
  const metadata = { cacheControl: 'public,max-age=31536000', contentType: file.type };
  
  return new Promise((resolve, reject) => {
    let isTimeout = false;
    // Attempt 0: Resumable (best for normal networks)
    // Attempt 1+: Simple upload (most robust for restricted proxies/slow connections)
    if (attempt === 0) {
      const uploadTask = uploadBytesResumable(fileRef, fileToUpload, metadata);
      if (onTask) onTask(uploadTask);
      
      const timeout = setTimeout(() => {
        isTimeout = true;
        uploadTask.cancel();
      }, 600000); // 10 minutes for massive dossiers

      uploadTask.on('state_changed', 
        (s) => {
          const p = (s.bytesTransferred / (s.totalBytes || 1)) * 100;
          if (onProgress) onProgress(Math.max(10, Math.min(99, p)));
        },
        async (err: any) => {
          clearTimeout(timeout);
          // If it's a timeout, we definitely want to retry with simple upload
          if (isTimeout && attempt < 2) {
            console.warn("Resumable timeout, falling back...");
            resolve(uploadFile(file, path, onProgress, onTask, attempt + 1));
          } else if (err.code === 'storage/canceled') {
            reject(new Error("Chargement annulé"));
          } else if (attempt < 2) {
            resolve(uploadFile(file, path, onProgress, onTask, attempt + 1));
          } else {
            console.error("Final upload failure", err);
            reject(new Error("Erreur de connexion (Timeout 600s)"));
          }
        },
        async () => {
          clearTimeout(timeout);
          try {
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          } catch (e) {
            reject(new Error("Échec final de l'URL"));
          }
        }
      );
    } else {
      if (onProgress) onProgress(20 + (attempt * 15));
      uploadBytes(fileRef, fileToUpload, metadata)
        .then(async (s) => resolve(await getDownloadURL(s.ref)))
        .catch(async (e) => {
          if (attempt < 2) resolve(uploadFile(file, path, onProgress, onTask, attempt + 1));
          else reject(new Error("Échec de transmission après plusieurs tentatives"));
        });
    }
  });
}

// --- Contexts ---
const AuthContext = createContext<{
  user: AppUser | null;
  loading: boolean;
  authActionLoading: boolean;
  isAdminMode: boolean;
  isAdminAuthenticated: boolean;
  userViewMode: boolean;
  activeRole: UserRole | null;
  availableRoles: UserRole[];
  internalAuthPending: boolean;
  isFirstSetup: boolean;
  setAdminMode: (val: boolean) => void;
  setAdminAuthenticated: (val: boolean) => void;
  setUserViewMode: (val: boolean) => void;
  setActiveRole: (val: UserRole) => void;
  setInternalAuthPending: (val: boolean) => void;
  setIsFirstSetup: (val: boolean) => void;
  loginWithGoogle: () => Promise<void>;
  reauthenticate: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
} | null>(null);

const ThemeContext = createContext<{
  theme: ThemeConfig;
  updateTheme: (newTheme: Partial<ThemeConfig>) => void;
} | null>(null);

// --- Components ---

function updateFavicon(url: string) {
  if (!url) return;
  const isBlob = url.startsWith('blob:');
  const cacheBuster = isBlob ? '' : `?t=${Date.now()}`;
  let link: HTMLLinkElement | null = document.getElementById('favicon') as HTMLLinkElement;
  if (!link) {
    link = document.querySelector("link[rel*='icon']");
  }
  
  const finalUrl = isBlob ? url : (url.includes('?') ? (url + cacheBuster.replace('?', '&')) : (url + cacheBuster));

  if (link) {
    link.href = finalUrl;
    if (!link.id) link.id = 'favicon';
  } else {
    const newLink = document.createElement('link');
    newLink.id = 'favicon';
    newLink.rel = 'icon';
    newLink.href = finalUrl;
    document.head.appendChild(newLink);
  }
}

const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<ThemeConfig>(() => {
    // Étape 1 : Au démarrage de l'application, vérification du stockage local
    const savedBranding = localStorage.getItem('dgi_branding');
    const savedTheme = localStorage.getItem('dgi_theme');
    
    let baseTheme = DEFAULT_THEME;
    if (savedBranding) {
        try {
            baseTheme = { ...DEFAULT_THEME, ...JSON.parse(savedBranding) };
        } catch (e) {
            // fallback if failed to parse
        }
    } else if (savedTheme) {
        try {
            baseTheme = { ...DEFAULT_THEME, ...JSON.parse(savedTheme) };
        } catch(e) {
            baseTheme = DEFAULT_THEME;
        }
    }

    // --- INITIAL MODE DETECTION ---
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode') || params.get('simu');
    const isDGIMode = modeParam === 'dgi_echange' || modeParam === 'dgi_exchange' || localStorage.getItem('dgi_mode') === 'true';

    if (isDGIMode) {
       localStorage.setItem('dgi_mode', 'true');
       return {
         ...baseTheme,
         primary: '#1E3A8A', // Deep Navy Blue (DGI)
         secondary: '#F1F5F9', // Light Slate Grey
         borderRadius: 8,
         cardShadow: 'sm',
         componentPadding: 'compact',
         appName: 'DGI ÉCHANGE',
         appTitle: 'Plateforme Nationale d\'Échange - DGI RDC',
         welcomeMessage: 'Simulation du système DGI Échange. Ce portail centralise les communications entre la Direction Générale des Impôts et les opérateurs économiques.',
         supportEmail: 'contact.echange@dgi.gouv.cd',
         footerText: '© 2026 République Démocratique du Congo - Direction Générale des Impôts',
         logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Coat_of_arms_of_the_Democratic_Republic_of_the_Congo.svg/200px-Coat_of_arms_of_the_Democratic_Republic_of_the_Congo.svg.png'
       };
    }

    return baseTheme;
  });

  useEffect(() => {
    // Étape 2 : Lancement de l'écouteur Firestore en parallèle
    const unsub = onSnapshot(doc(db, 'settings', 'branding'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as ThemeConfig;
        
        // Sauvegarde immédiate dans le stockage local pour persistance
        localStorage.setItem('dgi_branding', JSON.stringify(data));
        
        setTheme(prev => {
          if (data.updatedAt && prev.updatedAt && data.updatedAt < prev.updatedAt) {
            return prev;
          }
          const merged = { ...prev, ...data };
          
          const params = new URLSearchParams(window.location.search);
          const modeParam = params.get('mode') || params.get('simu');
          const isDGIMode = modeParam === 'dgi_echange' || modeParam === 'dgi_exchange' || localStorage.getItem('dgi_mode') === 'true';
          
          if (isDGIMode) {
             return {
               ...merged,
               primary: '#1E3A8A',
               secondary: '#F1F5F9',
               borderRadius: 8,
               cardShadow: 'sm',
               componentPadding: 'compact',
               appName: 'DGI ÉCHANGE',
               appTitle: 'Plateforme Nationale d\'Échange - DGI RDC',
               welcomeMessage: 'Simulation du système DGI Échange. Ce portail centralise les communications entre la Direction Générale des Impôts et les opérateurs économiques.',
               supportEmail: 'contact.echange@dgi.gouv.cd',
               footerText: '© 2026 République Démocratique du Congo - Direction Générale des Impôts',
               logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Coat_of_arms_of_the_Democratic_Republic_of_the_Congo.svg/200px-Coat_of_arms_of_the_Democratic_Republic_of_the_Congo.svg.png'
             };
          }

          localStorage.setItem('dgi_theme', JSON.stringify(merged));
          if (data.faviconUrl) {
            updateFavicon(data.faviconUrl);
          }
          return merged;
        });
      } else {
        const initData = { ...DEFAULT_THEME, updatedAt: Date.now() };
        setDoc(doc(db, 'settings', 'branding'), initData);
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, 'settings/branding'));
    return () => unsub();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // Set dynamic CSS variables
    root.style.setProperty('--primary-color', theme.primary);
    root.style.setProperty('--secondary-color', theme.secondary);
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--secondary', theme.secondary);
    root.style.setProperty('--font-main', theme.font);
    root.style.setProperty('--radius', `${theme.borderRadius}px`);
    
    const shadowMap = {
      none: 'none',
      sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
      '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)'
    };
    root.style.setProperty('--card-shadow', shadowMap[theme.cardShadow]);
    
    const paddingMap = {
      compact: '1rem',
      normal: '2.5rem',
      relaxed: '4rem'
    };
    root.style.setProperty('--comp-padding', paddingMap[theme.componentPadding]);

    if (theme.faviconUrl) {
        updateFavicon(theme.faviconUrl);
    }
    document.title = theme.appTitle || 'Portail DGI';
  }, [theme]);

  const updateTheme = async (newTheme: Partial<ThemeConfig>, isLocal = false) => {
    const now = Date.now();
    const updatePatch = { ...newTheme, updatedAt: now };

    setTheme(prev => {
      const updated = { ...prev, ...updatePatch };
      localStorage.setItem('dgi_theme', JSON.stringify(updated));
      return updated;
    });

    if (!isLocal) {
        // --- DATA SANITIZATION: STRIP LARGE BASE64 PAYLOADS FOR FIRESTORE ---
        const firestorePatch = { ...updatePatch };
        if (typeof firestorePatch.logoUrl === 'string' && firestorePatch.logoUrl.startsWith('data:')) {
            delete firestorePatch.logoUrl;
        }
        if (typeof firestorePatch.faviconUrl === 'string' && firestorePatch.faviconUrl.startsWith('data:')) {
            delete firestorePatch.faviconUrl;
        }

        try {
            await setDoc(doc(db, 'settings', 'branding'), firestorePatch, { merge: true });
        } catch (e) {
            console.error("Identity Persist Error:", e);
        }
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, updateTheme }}>
      <div style={{ fontFamily: theme.font }}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
};

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
       if (loading) setLoading(false);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [isAdminMode, setAdminMode] = useState(false);
  const [isAdminAuthenticated, setAdminAuthenticated] = useState(false);
  const [userViewMode, setUserViewMode] = useState(false);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);
  const [internalAuthPending, setInternalAuthPending] = useState(false);
  const [isFirstSetup, setIsFirstSetup] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<UserRole[]>([]);

  useEffect(() => {
    testConnection();
    let unsubDoc: (() => void) | null = null;
    
    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubDoc) {
        unsubDoc();
        unsubDoc = null;
      }

      if (fbUser) {
        setLoading(true);
        
        // --- DUAL ROLE CHECK ---
        try {
          // Rule 3: Query the agents collection BEFORE the taxpayers (contribuables) collection
          const agentsRef = collection(db, 'agents');
          const agentSnap = await getDocs(query(agentsRef, where('email', '==', fbUser.email)));
          
          const roles: UserRole[] = [];
          
          if (!agentSnap.empty) {
            const agentData = agentSnap.docs[0].data();
            roles.push(agentData.role || 'agent');
          }
          
          // Next, inspect the taxpayers collection
          const taxpayersRef = collection(db, 'contribuables');
          const taxpayerSnap = await getDocs(query(taxpayersRef, where('email', '==', fbUser.email)));
          
          if (!taxpayerSnap.empty) {
            roles.push('contributor');
          }
          
          // Master Admin bypass & Priority
          if (fbUser.email === 'sibinimigjc@gmail.com') {
             if (!roles.includes('admin')) roles.push('admin');
          }
          
          // Forced priority logic: if any professional role exists, ignore taxpayer view by default
          const professionalRoles = roles.filter(r => r === 'admin' || r === 'agent');
          const hasProfessionalRole = professionalRoles.length > 0;

          setAvailableRoles(roles);

          // Determine initial active role: Professional has precedence (ignore taxpayer view by default)
          let initialRole: UserRole = 'contributor';
          if (roles.includes('admin')) initialRole = 'admin';
          else if (roles.includes('agent')) initialRole = 'agent';
          
          setActiveRole(initialRole);

          const docRef = doc(db, 'users', fbUser.uid);
          unsubDoc = onSnapshot(docRef, async (docSnap) => {
            if (docSnap.exists()) {
              const userData = docSnap.data() as AppUser;
              
              // Internal Password Flow for Agents
              if (hasProfessionalRole) {
                  const isSuperAdmin = fbUser.email === 'sibinimigjc@gmail.com';
                  if (!isSuperAdmin) {
                      // Supprime complètement la demande de mot de passe pour tous les agents ordinaires
                      setAdminAuthenticated(true);
                      setIsFirstSetup(false);
                      setInternalAuthPending(false);
                  } else {
                      // Le Super-Admin unique requiert toujours le code maître de sécurité maximal
                      if (!isAdminAuthenticated) {
                          setIsFirstSetup(false);
                          setInternalAuthPending(true);
                      } else {
                          setIsFirstSetup(false);
                          setInternalAuthPending(false);
                      }
                  }
              } else {
                  setIsFirstSetup(false);
                  setInternalAuthPending(false);
              }

              setUser(userData);
              setAdminMode(userData.role === 'admin' || userData.role === 'agent');
              setLoading(false);
            } else {
              // Registration with profile adoption lookup (inheriting from preconfigured accounts)
              const usersRef = collection(db, 'users');
              const emailSnap = await getDocs(query(usersRef, where('email', '==', fbUser.email)));
              
              let existingData: any = null;
              if (!emailSnap.empty) {
                const matchedDoc = emailSnap.docs[0];
                existingData = matchedDoc.data();
                await deleteDoc(matchedDoc.ref);
              }

              // Update/Sync agents collection to point to the correct user UID if matched
              if (!agentSnap.empty) {
                const matchedAgentDoc = agentSnap.docs[0];
                if (matchedAgentDoc.id !== fbUser.uid) {
                  await deleteDoc(matchedAgentDoc.ref);
                  await setDoc(doc(db, 'agents', fbUser.uid), {
                    email: fbUser.email,
                    role: matchedAgentDoc.data().role || 'agent',
                    displayName: fbUser.displayName || matchedAgentDoc.data().displayName,
                    uid: fbUser.uid
                  });
                }
              }

              // If it's a taxpayer, look up any pending registration info in localStorage
              let taxNumber = '';
              let companyName = '';
              if (!hasProfessionalRole) {
                const pendingJson = localStorage.getItem('pending_taxpayer_reg');
                if (pendingJson) {
                  try {
                    const parsed = JSON.parse(pendingJson);
                    taxNumber = parsed.taxNumber || '';
                    companyName = parsed.companyName || '';
                    localStorage.removeItem('pending_taxpayer_reg');
                  } catch (e) {
                    console.error("Failed to parse pending taxpayer reg", e);
                  }
                }
              }

              const newUser: AppUser = {
                uid: fbUser.uid,
                email: fbUser.email || '',
                role: existingData?.role || (hasProfessionalRole ? initialRole : 'contributor'),
                displayName: companyName || fbUser.displayName || existingData?.displayName || fbUser.displayName || 'Utilisateur',
                photoURL: fbUser.photoURL || '',
                isSetup: hasProfessionalRole ? true : !!taxNumber,
                isActive: true,
                isNew: hasProfessionalRole ? (existingData ? (existingData.isNew !== false) : true) : false, // Taxpayers never have the "isNew" password setup flag
                lastLogin: serverTimestamp(),
                internalPassword: existingData?.internalPassword || null,
                phone: existingData?.phone || null,
                address: existingData?.address || null,
                permissions: existingData?.permissions || [],
                taxNumber: taxNumber || null,
                companyName: companyName || null
              };
              await setDoc(docRef, newUser);

              // If registering as a taxpayer, also populate the contribuables collection
              if (!hasProfessionalRole && taxNumber) {
                await setDoc(doc(db, 'contribuables', fbUser.uid), {
                  uid: fbUser.uid,
                  email: fbUser.email,
                  taxNumber: taxNumber,
                  companyName: companyName,
                  role: 'contributor'
                });
              }
            }
          });

        } catch (err) {
          handleFirestoreError(err, OperationType.GET, 'auth_role_check');
          setLoading(false);
        }
      } else {
        setUser(null);
        setActiveRole(null);
        setAvailableRoles([]);
        setInternalAuthPending(false);
        setIsFirstSetup(false);
        setAdminMode(false);
        setAdminAuthenticated(false);
        setLoading(false);
      }
    });
    
    return () => {
      unsubAuth();
      if (unsubDoc) unsubDoc();
    };
  }, [isAdminAuthenticated]);

  const loginWithGoogle = async () => {
    if (authActionLoading) return;
    setAuthActionLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ 
        prompt: 'select_account'
      });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        alert("La fenêtre de connexion a été bloquée par votre navigateur. Veuillez autoriser les fenêtres surgissantes (popups) pour ce site.");
      } else if (error.code === 'auth/cancelled-popup-request' || 
          error.code === 'auth/popup-closed-by-user') {
        // User cancelled, safe to ignore
      } else if (error.code === 'auth/network-request-failed') {
        alert("Erreur réseau : Impossible de contacter les services d'authentification Google. Vérifiez votre connexion internet ou désactivez vos éventuels bloqueurs de traqueurs/pubs.");
      } else {
        console.error("Auth error:", error);
      }
    } finally {
      setAuthActionLoading(false);
    }
  };

  const reauthenticate = async (password: string): Promise<boolean> => {
    // Basic password validation for internal auth
    return isMasterCodeValid(password); 
  };

  const logout = async () => {
    await signOut(auth);
    setAdminMode(false);
    setAdminAuthenticated(false);
    setUserViewMode(false);
    setInternalAuthPending(false);
    setIsFirstSetup(false);
  };

  // AUTO LOGIN SIMULATION FOR MASTER ADMIN
  useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('auto_login') === 'true' && !user && !loading && !authActionLoading) {
          loginWithGoogle();
      }
  }, [user, loading, authActionLoading]);

  return (
    <AuthContext.Provider value={{ 
      user, loading, authActionLoading, isAdminMode, isAdminAuthenticated, userViewMode,
      activeRole, availableRoles, internalAuthPending, isFirstSetup,
      setAdminMode, setAdminAuthenticated, setUserViewMode, setActiveRole, setInternalAuthPending, setIsFirstSetup,
      loginWithGoogle, reauthenticate, logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};

const hasPermission = (user: AppUser | null, permission: AgentPermission) => {
    if (!user) return false;
    if (user.email === 'sibinimigjc@gmail.com' || user.role === 'admin') return true;
    return user.permissions?.includes(permission);
};

// --- UI Components ---

const SidebarLink = ({ to, icon: Icon, label, active }: { to: string, icon: any, label: string, active?: boolean }) => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className={cn(
        "flex items-center gap-3 w-full px-6 py-3 text-sm font-medium transition-all group",
        active 
          ? "bg-[#F9EBEA] text-[#A93226] font-bold border-r-4 border-primary" 
          : "text-gray-700 hover:bg-[#F9EBEA]/50"
      )}
    >
      <Icon size={18} className={cn(active ? "text-primary" : "text-gray-400 group-hover:text-primary transition-colors")} />
      <span>{label}</span>
    </button>
  );
};

const AppShell = ({ children }: { children: React.ReactNode }) => {
  const { 
    user, isAdminMode, setAdminMode, isAdminAuthenticated, setAdminAuthenticated, logout, 
    userViewMode, setUserViewMode, reauthenticate, activeRole, availableRoles, setActiveRole,
    internalAuthPending, setInternalAuthPending, isFirstSetup, setIsFirstSetup
  } = useAuth();
  const { theme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isReauthOpen, setIsReauthOpen] = useState(false);
  
  // Internal Pass states
  const [tempStartPass, setTempStartPass] = useState('');
  const [internalPass, setInternalPass] = useState('');
  const [internalPassConfirm, setInternalPassConfirm] = useState('');
  const [internalError, setInternalError] = useState('');
  
  const [reauthPass, setReauthPass] = useState('');
  const [reauthError, setReauthError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    updateFavicon(theme.faviconUrl);
    document.title = `${theme.appTitle || 'DGI'} | ${userViewMode ? 'Portail Contribuable' : 'République Démocratique du Congo'}`;
  }, [theme.faviconUrl, theme.appTitle, userViewMode]);

  const toggleAdminMode = async () => {
    if (isAdminMode && !userViewMode) {
      setUserViewMode(true);
      setAdminAuthenticated(false);
      navigate('/');
    } else if (userViewMode) {
      setIsReauthOpen(true);
    } else {
      setIsReauthOpen(true);
    }
  };

  const handleReauth = async () => {
    const success = await reauthenticate(reauthPass);
    if (success) {
      setAdminMode(true);
      setAdminAuthenticated(true);
      setUserViewMode(false);
      setIsReauthOpen(false);
      setReauthPass('');
      setReauthError('');
      navigate('/admin');
    } else {
      setReauthError('Code de sécurité invalide');
    }
  };

  const handleInternalAuth = async () => {
    if (isFirstSetup) {
      if (!tempStartPass) {
        setInternalError('Le mot de passe de départ (fourni par l\'administrateur) est requis');
        return;
      }
      if (tempStartPass !== user?.internalPassword) {
        setInternalError('Le mot de passe de départ est incorrect');
        return;
      }
      if (internalPass.length < 6) {
        setInternalError('Le nouveau mot de passe doit faire au moins 6 caractères');
        return;
      }
      if (internalPass !== internalPassConfirm) {
        setInternalError('Les nouveaux mots de passe ne correspondent pas');
        return;
      }
      // Save password
      try {
        await updateDoc(doc(db, 'users', user!.uid), {
          internalPassword: internalPass,
          isNew: false
        });
        await updateDoc(doc(db, 'agents', user!.uid), {
          password: internalPass,
          isNew: false
        });
        setAdminAuthenticated(true);
        setInternalAuthPending(false);
        setIsFirstSetup(false);
        setTempStartPass('');
        setInternalPass('');
        setInternalPassConfirm('');
        // Forcer la vue Gestionnaire (Agent) et rediriger
        setUserViewMode(false);
        setAdminMode(true);
        navigate('/admin');
      } catch (e) {
        setInternalError('Erreur lors de l\'enregistrement');
      }
    } else {
      const emailIsSibi = user?.email === 'sibinimigjc@gmail.com';
      const isPasswordValid = emailIsSibi 
        ? isMasterCodeValid(internalPass)
        : (internalPass === user?.internalPassword);

      if (isPasswordValid) {
        setAdminAuthenticated(true);
        setInternalAuthPending(false);
        setInternalPass('');
        setInternalError('');
        // Forcer la vue Gestionnaire (Agent) et rediriger
        setUserViewMode(false);
        setAdminMode(true);
        navigate('/admin');
      } else {
        setInternalError('Mot de passe interne incorrect');
      }
    }
  };

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'agent') && isAdminAuthenticated && !userViewMode) {
      if (location.pathname === '/' || location.pathname === '/login') {
        navigate('/admin');
      }
    }
  }, [user, isAdminAuthenticated, userViewMode, location.pathname, navigate]);

  const switchRole = async (role: UserRole) => {
    setActiveRole(role);
    // Update role in session doc if needed or just handle via activeRole
    // For DGI mode, we usually want to persist the role change in users collection
    await updateDoc(doc(db, 'users', user!.uid), { role });
    if (role === 'contributor') {
        setUserViewMode(true);
        setAdminMode(false);
        navigate('/');
    } else {
        setUserViewMode(false);
        setAdminMode(true);
        navigate('/admin');
    }
  };

  const Header = () => (
    <header className="h-[56px] md:h-[70px] bg-primary text-white flex items-center justify-between px-3 md:px-6 shadow-md z-[70] shrink-0">
      <div className="flex items-center gap-2 md:gap-3">
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-1.5 -ml-1 hover:bg-white/10 rounded-lg lg:hidden transition-colors"
        >
          {isSidebarOpen ? <X size={18} /> : <Layout size={18} />}
        </button>
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-white p-1 flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
            <img 
              src={theme.logoUrl || DEFAULT_THEME.logoUrl} 
              alt="DGI" 
              className="w-full h-full object-contain" 
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (!target.src.includes('cdn-icons')) {
                  target.src = DEFAULT_THEME.logoUrl;
                }
              }} 
            />
          </div>
          <div className="hidden xs:block">
            <h1 className="text-[11px] md:text-lg font-black leading-tight uppercase tracking-tighter">{theme.appName}</h1>
            <p className="text-[7px] md:text-[10px] opacity-70 uppercase tracking-widest font-bold">République Démocratique du Congo</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-6">
        {user?.role === 'admin' && (
          <button 
            onClick={toggleAdminMode}
            className={cn(
               "text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] px-2 md:px-4 py-2 border rounded-lg md:rounded-xl transition-all shadow-lg flex items-center gap-2 group whitespace-nowrap",
               userViewMode ? "bg-orange-600 border-orange-500 text-white" : "bg-white text-primary border-white"
            )}
          >
            <Shield size={12} className={cn(userViewMode && "animate-pulse")} />
            <span className="hidden sm:inline">{userViewMode ? "Sortir du Mode Aperçu" : "Passer en Mode Admin"}</span>
            <span className="sm:hidden">{userViewMode ? "Sortir" : "Admin"}</span>
          </button>
        )}

        {availableRoles.includes('contributor') && (availableRoles.includes('agent') || availableRoles.includes('admin')) && (
          <button 
            onClick={() => switchRole(activeRole === 'contributor' ? (availableRoles.find(r => r !== 'contributor') || 'agent') : 'contributor')}
            className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] px-2 md:px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg md:rounded-xl transition-all shadow-lg flex items-center gap-2 group whitespace-nowrap border border-amber-500"
          >
            <ArrowRightLeft size={12} className="group-hover:rotate-180 transition-transform duration-500 text-amber-100" />
            <span>
              {activeRole === 'contributor' ? 'Basculer vers mon espace Agent' : 'Basculer vers mon espace Contribuable'}
            </span>
          </button>
        )}
        <div className="flex items-center gap-2 md:gap-4 border-l border-white/20 pl-3 md:pl-6 h-10">
          <div className="text-right hidden sm:block">
            <p className="text-xs md:text-sm font-black tracking-tight leading-none mb-1 truncate max-w-[120px]">{user?.displayName}</p>
            <p className="text-[8px] md:text-[9px] opacity-70 font-bold uppercase tracking-widest leading-none">
              {(userViewMode || user?.role === 'contributor') ? 'Portail Contribuable' : (user?.role === 'admin' ? 'Admin DGI' : 'Agent DGI')}
            </p>
          </div>
          {user?.photoURL ? (
            <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 md:w-10 md:h-10 rounded-full border-2 border-white/20 object-cover shrink-0" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-white/10 flex items-center justify-center font-black text-xs md:text-sm shrink-0">
              {user?.displayName?.[0]}
            </div>
          )}
        </div>
      </div>
    </header>
  );

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Internal Password Flow Overlay */}
      {internalAuthPending && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#F4F7F6] p-4 animate-in fade-in duration-500">
            <div className="bg-white p-10 md:p-16 rounded-[3.5rem] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.1)] max-w-md w-full text-center border border-white">
                <div className="w-24 h-24 bg-primary/5 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-10 shadow-inner">
                    <Lock size={48} className="animate-pulse" />
                </div>
                
                <h2 className="text-2xl font-black text-[#2C3E50] mb-4 tracking-tighter uppercase italic">
                    {isFirstSetup ? "Initialisation Sécurisée" : "Authentification Métier"}
                </h2>
                
                <p className="text-xs text-gray-400 font-bold uppercase tracking-[0.2em] mb-10 leading-relaxed">
                    {isFirstSetup 
                        ? "Veuillez définir votre mot de passe interne pour finaliser l'accès à la plateforme DGI."
                        : `Veuillez saisir votre mot de passe interne pour déverrouiller le compte ${user?.role === 'admin' ? 'Administrateur' : 'Agent'}.`}
                </p>

                <div className="space-y-6">
                    {isFirstSetup && (
                        <div className="relative group">
                            <Key className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={20} />
                            <input 
                                type="password"
                                autoFocus
                                placeholder="Mot de Passe de Départ"
                                className="w-full pl-16 pr-6 py-5 bg-amber-50/20 border border-amber-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-center text-xl tracking-[0.3em] font-black transition-all shadow-inner placeholder:text-gray-400 placeholder:tracking-normal placeholder:font-medium text-amber-700"
                                value={tempStartPass}
                                onChange={e => setTempStartPass(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="relative group">
                        <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={20} />
                        <input 
                            type="password"
                            autoFocus={!isFirstSetup}
                            placeholder={isFirstSetup ? "Nouveau Mot de Passe" : "Mot de Passe Interne"}
                            className="w-full pl-16 pr-6 py-5 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-center text-xl tracking-[0.3em] font-black transition-all shadow-inner placeholder:text-gray-400 placeholder:tracking-normal placeholder:font-medium"
                            value={internalPass}
                            onChange={e => setInternalPass(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && (!isFirstSetup && handleInternalAuth())}
                        />
                    </div>

                    {isFirstSetup && (
                        <div className="relative group">
                             <ShieldCheck className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={20} />
                             <input 
                                type="password"
                                placeholder="Confirmer le Nouveau MDP"
                                className="w-full pl-16 pr-6 py-5 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-center text-xl tracking-[0.3em] font-black transition-all shadow-inner placeholder:text-gray-400 placeholder:tracking-normal placeholder:font-medium"
                                value={internalPassConfirm}
                                onChange={e => setInternalPassConfirm(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleInternalAuth()}
                            />
                        </div>
                    )}

                    {internalError && (
                        <div className="flex items-center justify-center gap-2 text-red-600 bg-red-50 p-4 rounded-xl animate-in shake duration-300">
                            <AlertCircle size={14} />
                            <p className="text-[10px] font-black uppercase tracking-widest">{internalError}</p>
                        </div>
                    )}

                    <button 
                        onClick={handleInternalAuth}
                        className="w-full py-6 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-4"
                    >
                        <span>{isFirstSetup ? "Sceller le Compte" : "Déverrouiller l'Interface"}</span>
                        <ArrowRight size={20} />
                    </button>

                    <button 
                        onClick={logout}
                        className="text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-red-500 transition-colors pt-4"
                    >
                        Changer de compte
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Re-auth Modal */}
      {isReauthOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4">
          <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center border border-white relative">
            <button 
              onClick={() => {
                setIsReauthOpen(false);
                if (!userViewMode) {
                  // If we were trying to enter admin mode, we can just stay in user view
                  // But if the user wants "back to connection", maybe logout?
                  // User specifically asked to return to connection page.
                }
              }}
              className="absolute top-4 right-4 p-2 text-gray-300 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-all"
            >
              <X size={20} />
            </button>
            <ShieldLock size={48} className="mx-auto mb-6 text-primary" />
            <h2 className="text-xl font-black text-[#2C3E50] mb-2 tracking-tighter uppercase italic">Validation Maître</h2>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-8">Saisir le code pour restaurer l'accès Admin</p>
            <input 
              type="password"
              autoFocus
              className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-center text-xl tracking-[0.5em] font-black transition-all mb-4 shadow-inner"
              value={reauthPass}
              onChange={e => setReauthPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReauth()}
              placeholder="••••••••"
            />
            {reauthError && <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-4">{reauthError}</p>}
            <div className="flex gap-4">
               <button 
                onClick={() => { setIsReauthOpen(false); if(userViewMode) navigate('/'); }}
                className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center"
              >
                {userViewMode ? "Rester Contribuable" : "Annuler"}
              </button>
              <button 
                onClick={handleReauth}
                className="flex-1 py-4 bg-primary text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
              >
                Déverrouiller
              </button>
            </div>
          </div>
        </div>
      )}

      <Header />

      {/* Admin Mode Overlay (Floating Return Button) */}
      {userViewMode && (
        <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-bottom duration-500">
          <button 
            onClick={toggleAdminMode}
            className="group flex items-center gap-3 bg-[#A93226] text-white p-2 md:p-4 pr-6 md:pr-10 rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all border-4 border-white/20"
          >
            <div className="w-8 h-8 md:w-12 md:h-12 bg-white/20 rounded-full flex items-center justify-center animate-pulse">
              <ShieldCheck size={20} />
            </div>
            <div className="text-left">
              <p className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] opacity-70 leading-none mb-1">Mode Aperçu</p>
              <p className="text-[10px] md:text-sm font-black uppercase tracking-tighter leading-none">Restaurer l'Admin</p>
            </div>
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[55] lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Sidebar / Drawer */}
        <aside className={cn(
          "fixed lg:relative lg:translate-x-0 z-[60] lg:z-10 bg-white border-r border-gray-100 flex flex-col shrink-0 transition-transform duration-300 ease-in-out h-full w-72 shadow-2xl lg:shadow-none",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}>
          {/* Mobile Close Button */}
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden absolute top-4 right-4 p-2 text-gray-400 hover:text-primary transition-colors"
          >
            <X size={24} />
          </button>

          <nav className="flex-1 py-10 px-4 space-y-2 overflow-y-auto scrollbar-hide">
            {(!isAdminMode || userViewMode) ? (
              <>
                <div className="px-6 mb-6">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Espace Contribuable</p>
                </div>
                <SidebarLink to="/" icon={Layout} label="Tableau de Bord" active={location.pathname === '/'} />
                <SidebarLink to="/messaging" icon={Mail} label="Mes Conversations" active={location.pathname === '/messaging'} />
                <SidebarLink to="/account" icon={UserCircle} label="Mon Compte" active={location.pathname === '/account'} />
              </>
            ) : (
              <>
                <div className="px-6 mb-6">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Espace Stratégique</p>
                </div>
                <SidebarLink to="/admin" icon={Layers} label="Vue Panoramique" active={location.pathname === '/admin'} />
                <SidebarLink to="/messaging" icon={Mail} label="Conversations Contribuables" active={location.pathname === '/messaging'} />
                <SidebarLink to="/internal" icon={MessageSquare} label="Conversations Staff" active={location.pathname === '/internal'} />
                {(hasPermission(user, 'tax_consultation') || hasPermission(user, 'deletion') || (user as any)?.isSuperContribuable) && (
                    <SidebarLink to="/directory" icon={Users} label="Annuaire National" active={location.pathname === '/directory'} />
                )}
              </>
            )}
          </nav>

          <nav className="p-4 border-t border-gray-100 space-y-1 bg-gray-50/50">
            {availableRoles.length > 1 && (
              <div className="px-6 py-4 space-y-3">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Multi-Profil Détecté</p>
                  <button 
                    onClick={() => switchRole(activeRole === 'contributor' ? (availableRoles.find(r => r !== 'contributor') || 'agent') : 'contributor')}
                    className="flex items-center gap-3 w-full px-4 py-3 bg-white border border-gray-100 text-primary rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm hover:shadow-md transition-all group"
                  >
                    <ArrowRightLeft size={16} className="text-primary group-hover:rotate-180 transition-transform duration-500" />
                    <span>{activeRole === 'contributor' ? 'Retourner à l\'Espace DGI' : 'Accéder à mon espace Contribuable'}</span>
                  </button>
              </div>
            )}
            {user?.role === 'admin' && (
              <button 
                onClick={toggleAdminMode}
                className={cn(
                  "flex items-center gap-3 w-full px-6 py-4 text-xs font-black uppercase tracking-widest transition-all rounded-xl shadow-sm border mb-2",
                  userViewMode 
                    ? "text-orange-600 bg-orange-50 border-orange-100 hover:bg-orange-100" 
                    : "text-green-600 bg-green-50 border-green-100 hover:bg-green-100"
                )}
              >
                {userViewMode ? <ShieldLock size={16} /> : <ShieldCheck size={16} />}
                <span>{userViewMode ? "Passer en Admin" : "Mode Aperçu Client"}</span>
              </button>
            )}
            <SidebarLink to="/settings" icon={Settings} label="Configuration" active={location.pathname === '/settings'} />
            
            <button 
              onClick={logout}
              className="flex items-center gap-3 w-full px-6 py-4 text-xs font-black text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all rounded-xl uppercase tracking-widest"
            >
              <LogOut size={16} />
              <span>Déconnexion</span>
            </button>
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-hidden relative flex flex-col h-full">
          {/* Topbar for Mobile */}
          <header className="h-16 bg-white border-b border-gray-100 flex items-center px-6 lg:hidden shrink-0 z-50">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 text-primary"
            >
              <Menu size={24} />
            </button>
            <div className="flex-1 flex items-center justify-center">
              <img src={theme.logoUrl} className="h-8 w-auto" alt={theme.appName} referrerPolicy="no-referrer" />
            </div>
            <button 
              onClick={logout}
              className="p-2 -mr-2 text-gray-400"
            >
              <LogOut size={20} />
            </button>
          </header>

          <div className="flex-1 overflow-auto bg-[#F4F7F6]">
            {userViewMode && location.pathname === '/' ? <UserPortal /> : children}
          </div>

          {/* Status Strip */}
          <footer className="h-6 bg-white border-t border-gray-200 text-[10px] flex items-center px-4 text-gray-400 shrink-0 z-10 hidden sm:flex">
             <div className="flex items-center gap-2">
                <span className="text-green-500">●</span>
                <span>Firestore V3 Architecture</span>
             </div>
             <div className="ml-auto opacity-50 uppercase tracking-widest font-black">
                Mode: {isAdminMode ? 'Admin Stratégique' : 'Contribuable'}
             </div>
          </footer>
        </main>
      </div>
    </div>
  );
};

// --- Pages ---

const UserPortal = () => {
    return <DashboardPage />;
};

const DashboardPage = () => {
    const { user, isAdminMode, userViewMode } = useAuth();
    const { theme } = useTheme();
    const navigate = useNavigate();
    const [stats, setStats] = useState({ messages: 0, dossiers: 0, agents: 0 });
    const [recent, setRecent] = useState<Conversation[]>([]);

    useEffect(() => {
        if (!user) return;
        
        const isSuperAdmin = user.email === 'sibinimigjc@gmail.com';
        let qConv;
        if (isSuperAdmin) {
            qConv = query(collection(db, 'conversations'), orderBy('lastUpdate', 'desc'), limit(10));
        } else if (user.role === 'agent' || user.role === 'admin') {
            qConv = query(
                collection(db, 'conversations'),
                where('assignedAgentId', '==', user.uid)
            );
        } else {
            qConv = query(
                collection(db, 'conversations'), 
                where('participants', 'array-contains', user.uid),
                orderBy('lastUpdate', 'desc'), 
                limit(10)
            );
        }

        const unsubConv = onSnapshot(qConv, (snap) => {
            let all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation));
            if (!isSuperAdmin && (user.role === 'agent' || user.role === 'admin')) {
                all.sort((a, b) => {
                    const tA = a.lastUpdate?.toMillis ? a.lastUpdate.toMillis() : (a.lastUpdate?.seconds ? a.lastUpdate.seconds * 1000 : 0);
                    const tB = b.lastUpdate?.toMillis ? b.lastUpdate.toMillis() : (b.lastUpdate?.seconds ? b.lastUpdate.seconds * 1000 : 0);
                    return tB - tA;
                });
                all = all.slice(0, 10);
            }
            setStats(prev => ({ ...prev, messages: all.length }));
            setRecent(all);
        }, err => handleFirestoreError(err, OperationType.LIST, 'conversations'));

        let unsubUsers = () => {};
        const isSuper = (user as any).isSuperContribuable;
        if (!userViewMode && (user.role === 'admin' || user.role === 'agent' || isSuper)) {
            const qUsers = (user.role === 'admin' || isSuper)
                ? query(collection(db, 'users'))
                : query(
                    collection(db, 'users'),
                    or(
                        where('role', 'in', ['agent', 'admin']),
                        where('assignedAgentId', '==', null),
                        where('assignedAgentId', '==', user.uid)
                    )
                );

            unsubUsers = onSnapshot(qUsers, (snap) => {
                const docs = snap.docs.map(d => d.data() as AppUser);
                setStats(p => ({ 
                    ...p, 
                    dossiers: docs.filter(u => u.role === 'contributor').length,
                    agents: docs.filter(u => u.role === 'agent').length
                }));
            }, err => handleFirestoreError(err, OperationType.LIST, 'users'));
        }

        return () => { unsubConv(); unsubUsers(); };
    }, [user, isAdminMode, userViewMode]);

    return (
        <div className="p-4 md:p-10 max-w-7xl font-sans bg-[#F4F7F6] min-h-screen">
            <header className="mb-8 md:mb-12 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl md:text-4xl font-black tracking-tight text-[#2C3E50] mb-2 uppercase italic leading-none">{theme.appName}</h1>
                    <p className="text-gray-400 font-bold uppercase tracking-[0.2em] text-[8px] md:text-[10px] opacity-60">Portail National | Direction Générale des Impôts</p>
                </div>
            </header>

            {theme.welcomeMessage && (user?.role === 'contributor' || userViewMode) && (
                <div className="mb-10 p-6 md:p-10 bg-white border-l-8 border-primary rounded-[2.5rem] shadow-2xl shadow-primary/5 animate-in slide-in-from-top duration-700">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="w-10 h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                            <Info size={20} />
                        </div>
                        <h4 className="text-xl font-black text-[#2C3E50] uppercase tracking-tighter italic">Note Officielle</h4>
                    </div>
                    <p className="text-sm text-gray-500 font-medium leading-relaxed whitespace-pre-wrap">{theme.welcomeMessage}</p>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-10 mb-8 md:mb-12">
                <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5 group hover:scale-[1.02] transition-transform duration-500 cursor-pointer" onClick={() => navigate('/internal')}>
                    <div className="flex items-center justify-between mb-6 md:mb-8">
                        <div className="p-3 md:p-4 bg-primary/10 text-primary rounded-[1.25rem] shadow-inner">
                            <Layers size={24} className="md:w-8 md:h-8" />
                        </div>
                        <span className="text-[8px] md:text-[10px] font-black text-gray-300 uppercase tracking-widest">Flux Direct</span>
                    </div>
                    <p className="text-4xl md:text-5xl font-black text-[#2C3E50] mb-2 tabular-nums">{stats.messages}</p>
                    <p className="text-[10px] md:text-xs font-black text-gray-400 uppercase tracking-widest">Conversations Staff (Interne)</p>
                </div>
                
                {(user.role === 'admin' && !userViewMode) && (
                    <>
                        <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5 group hover:scale-[1.02] transition-transform duration-500">
                            <div className="flex items-center justify-between mb-6 md:mb-8">
                                <div className="p-3 md:p-4 bg-blue-50 text-blue-600 rounded-[1.25rem] shadow-inner">
                                    <FileText size={24} className="md:w-8 md:h-8" />
                                </div>
                                <span className="text-[8px] md:text-[10px] font-black text-gray-300 uppercase tracking-widest">Opérations</span>
                            </div>
                            <p className="text-4xl md:text-5xl font-black text-[#2C3E50] mb-2 tabular-nums">{stats.dossiers}</p>
                            <p className="text-[10px] md:text-xs font-black text-gray-400 uppercase tracking-widest">Dossiers Contribuables</p>
                        </div>

                        <div className="bg-white p-6 md:p-10 rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5 group hover:scale-[1.02] transition-transform duration-500">
                            <div className="flex items-center justify-between mb-6 md:mb-8">
                                <div className="p-3 md:p-4 bg-green-50 text-green-600 rounded-[1.25rem] shadow-inner">
                                    <ShieldCheck size={24} className="md:w-8 md:h-8" />
                                </div>
                                <span className="text-[8px] md:text-[10px] font-black text-gray-300 uppercase tracking-widest">Staff</span>
                            </div>
                            <p className="text-4xl md:text-5xl font-black text-[#2C3E50] mb-2 tabular-nums">{stats.agents}</p>
                            <p className="text-[10px] md:text-xs font-black text-gray-400 uppercase tracking-widest">Agents Authentifiés</p>
                        </div>
                    </>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10">
                <div className="bg-white rounded-[2.5rem] md:rounded-[3.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5 overflow-hidden flex flex-col min-h-[400px] lg:h-[500px]">
                    <div className="px-6 md:px-10 py-6 md:py-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/30">
                        <h2 className="font-black text-lg md:text-xl text-[#2C3E50] uppercase tracking-tighter italic">Conversations Récentes</h2>
                        <button onClick={() => navigate('/messaging')} className="p-2 hover:bg-white rounded-xl transition-colors"><ChevronRight size={20} className="text-gray-400"/></button>
                    </div>
                    <div className="p-6 md:p-10 overflow-y-auto flex-1 scrollbar-hide">
                        {recent.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 py-10">
                                <RefreshCw size={48} className="mx-auto mb-4 animate-spin-slow" />
                                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-center">Aucun échange<br/>récent</p>
                            </div>
                        ) : (
                            <div className="space-y-6 md:space-y-8">
                                {recent.map((item) => (
                                    <div key={item.id} className="flex items-center gap-4 md:gap-6 group cursor-pointer" onClick={() => navigate('/messaging')}>
                                        <div className="w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-[1.25rem] bg-gray-50 flex items-center justify-center text-primary font-black text-sm md:text-lg border border-gray-100 group-hover:bg-primary group-hover:text-white transition-all shadow-sm shrink-0 uppercase">
                                            {(item.companyName || item.subject)[0]}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs md:text-sm font-black text-[#2C3E50] truncate uppercase tracking-tight">{item.companyName || 'DGI'}</p>
                                            <p className="text-[10px] text-gray-400 font-bold opacity-60 truncate mt-0.5">{item.subject}</p>
                                            <p className="text-[8px] md:text-[9px] text-primary/40 font-black uppercase tracking-widest mt-1">
                                                {item.lastUpdate?.toDate() ? item.lastUpdate.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                            </p>
                                        </div>
                                        <div className="hidden sm:block px-4 py-1.5 bg-primary/5 text-primary text-[10px] font-black rounded-full uppercase tracking-widest border border-primary/10 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Ouvrir</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-primary p-8 md:p-12 rounded-[2.5rem] md:rounded-[4rem] text-white relative overflow-hidden shadow-2xl shadow-primary/30 flex flex-col justify-between min-h-[300px]">
                    <div className="absolute top-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-[100px] -mr-40 -mt-20" />
                    <div className="relative z-10">
                        <Building2 size={64} className="mb-6 opacity-30" />
                        <h2 className="text-2xl md:text-4xl font-black mb-4 md:mb-6 leading-none uppercase tracking-tighter">Portail<br/>Numérique DGI</h2>
                        <p className="text-sm md:text-lg font-medium text-red-50/70 max-w-xs mb-8 italic">Simplifier la conformité fiscale pour bâtir l'avenir national.</p>
                    </div>

                    <div className="relative z-10 p-4 md:p-6 bg-black/10 backdrop-blur-md rounded-2xl md:rounded-[2.5rem] border border-white/5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/50" />
                                <span className="text-[10px] md:text-xs font-black uppercase tracking-widest">Opérationnel</span>
                            </div>
                            <ShieldCheck size={24} className="opacity-20" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const MessagingPage = () => {
    const { user, isAdminMode } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<Exchange[]>([]);
    const [isComposeOpen, setIsComposeOpen] = useState(false);
    const [agents, setAgents] = useState<AppUser[]>([]);
    const [taxpayers, setTaxpayers] = useState<AppUser[]>([]);
    const [isTransferOpen, setIsTransferOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [convToDelete, setConvToDelete] = useState<Conversation | null>(null);
    const [status, setStatus] = useState('');
    const [fileToView, setFileToView] = useState<Attachment | null>(null);

    useEffect(() => {
        const state = location.state as { receiverId?: string; subject?: string } | null;
        if (state?.receiverId) {
            setComposeData(prev => ({
                ...prev,
                receiverId: state.receiverId || 'global',
                subject: state.subject || ''
            }));
            setIsComposeOpen(true);
            // Clear location state to avoid re-opening on refresh
            window.history.replaceState({}, document.title);
        }
    }, [location]);

    useEffect(() => {
        if (status) {
            const timer = setTimeout(() => setStatus(''), 5000);
            return () => clearTimeout(timer);
        }
    }, [status]);

    useEffect(() => {
        const errorHandler = (event: ErrorEvent) => {
            alert(`Système: ${event.message} (${event.lineno})`);
        };
        window.addEventListener('error', errorHandler);
        return () => window.removeEventListener('error', errorHandler);
    }, []);
    
    // Compose State
    const [composeData, setComposeData] = useState({ subject: '', body: '', receiverId: 'global', searchTaxpayer: '', conversationId: '', isInternal: false });
    const [attachments, setAttachments] = useState<File[]>([]);
    const [uploadProgress, setUploadProgress] = useState<number[]>([]);
    const [uploadedFiles, setUploadedFiles] = useState<(Attachment | null)[]>([]);
    const [uploadErrors, setUploadErrors] = useState<(string | null)[]>([]);
    const [uploading, setUploading] = useState(false);
    const uploadPromisesRef = useRef<Map<number, Promise<Attachment>>>(new Map());
    const uploadTasksRef = useRef<Map<number, any>>(new Map());

    useEffect(() => {
        if (!user) return;
        
        const isSuperAdmin = user.email === 'sibinimigjc@gmail.com';
        let q;
        if (isSuperAdmin) {
            q = query(collection(db, 'conversations'), orderBy('lastUpdate', 'desc'));
        } else if (user.role === 'admin' || user.role === 'agent') {
            q = query(
                collection(db, 'conversations'),
                where('assignedAgentId', '==', user.uid)
            );
        } else {
            q = query(
                collection(db, 'conversations'), 
                where('participants', 'array-contains', user.uid),
                orderBy('lastUpdate', 'desc')
            );
        }
        
        const unsub = onSnapshot(q, 
            (snap) => {
                let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation));
                if (!isSuperAdmin && (user.role === 'admin' || user.role === 'agent')) {
                    list.sort((a, b) => {
                        const tA = a.lastUpdate?.toMillis ? a.lastUpdate.toMillis() : (a.lastUpdate?.seconds ? a.lastUpdate.seconds * 1000 : 0);
                        const tB = b.lastUpdate?.toMillis ? b.lastUpdate.toMillis() : (b.lastUpdate?.seconds ? b.lastUpdate.seconds * 1000 : 0);
                        return tB - tA;
                    });
                }
                setConversations(list);
            },
            (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
        );
        return () => unsub();
    }, [user?.uid, user?.role, user?.email]);

    useEffect(() => {
        if (!selectedConv) {
            setMessages([]);
            return;
        }

        const q = query(collection(db, 'conversations', selectedConv.id, 'messages'), orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(q, 
            (snap) => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Exchange))),
            (err) => handleFirestoreError(err, OperationType.LIST, `conversations/${selectedConv?.id}/messages`)
        );
        return () => unsub();
    }, [selectedConv?.id]);

    useEffect(() => {
        const isSuper = (user as any)?.isSuperContribuable;
        if (!user || (user.role !== 'admin' && user.role !== 'agent' && !isSuper)) {
            setAgents([]);
            setTaxpayers([]);
            return;
        }

        const qAgents = query(collection(db, 'users'), where('role', '==', 'agent'));
        const unsubAgents = onSnapshot(qAgents, 
            (snap) => setAgents(snap.docs.map(d => ({ ...d.data(), uid: d.id } as any))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'users_agents')
        );
        
        // MessagingPage relevant taxpayers query
        const qTax = (user.role === 'admin' || isSuper)
            ? query(collection(db, 'users'), where('role', '==', 'contributor'))
            : query(
                collection(db, 'users'), 
                and(
                    where('role', '==', 'contributor'),
                    where('assignedAgentId', '==', user.uid)
                )
            );
            
        const unsubTax = onSnapshot(qTax, 
            (snap) => setTaxpayers(snap.docs.map(d => ({ ...d.data(), uid: d.id } as any))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'users_taxpayers')
        );
        
        return () => { unsubAgents(); unsubTax(); };
    }, [user?.uid, user?.role]);

    const resetCompose = () => {
        setIsComposeOpen(false);
        setUploading(false);
        setAttachments([]);
        setUploadProgress([]);
        setUploadedFiles([]);
        setComposeData({ subject: '', body: '', receiverId: 'global', searchTaxpayer: '', conversationId: '' });
        uploadPromisesRef.current.clear();
        uploadTasksRef.current.clear();
    };

    const handleSend = async () => {
        if (!user) return;
        
        // Final Readiness Check
        const areFilesReady = attachments.length === 0 || (uploadedFiles.length === attachments.length && uploadedFiles.every(f => f !== null));
        if (!areFilesReady) {
            alert("Veuillez attendre la fin du chargement des documents.");
            return;
        }

        // Validation Agent: doit sélectionner un destinataire
        if ((user.role === 'admin' || user.role === 'agent') && composeData.receiverId === 'global' && !composeData.conversationId) {
            alert("Veuillez sélectionner un destinataire.");
            return;
        }

        const finalBody = composeData.body.trim();
        const finalSubject = composeData.subject.trim() || 'Sans Objet';
        
        if (!finalBody && attachments.length === 0) {
            alert("Le message ne peut pas être vide.");
            return;
        }
        
        setUploading(true);
        setStatus('Transmission sécurisée en cours...');

        try {
            // Already uploaded in background, take directly from state
            const finalAttachments = uploadedFiles.filter(Boolean) as Attachment[];

            let contributorId = user.role === 'contributor' ? user.uid : composeData.receiverId;
            let destId = composeData.receiverId === 'global' ? 'admin_dgi' : composeData.receiverId;
            
            const targetTaxpayer = user.role !== 'contributor' ? taxpayers.find(t => t.uid === contributorId) : user;
            
            // 2. Find or create conversation
            let conversationId = composeData.conversationId || selectedConv?.id;
            let currentParticipants = selectedConv?.participants || [user.uid, destId];

            if (!conversationId) {
                const q = query(
                    collection(db, 'conversations'),
                    where('subject', '==', finalSubject),
                    where('participants', 'array-contains', user.uid)
                );
                const snap = await getDocs(q);
                const matchedConv = snap.docs.find(d => (d.data().participants as string[]).includes(destId));
                
                if (matchedConv) {
                    conversationId = matchedConv.id;
                    currentParticipants = matchedConv.data().participants;
                }
            }

            if (!conversationId) {
                let finalAssignedAgentId = 'global';
                let finalAssignedAgentEmail = 'global';
                let finalAssignedAgentName = 'Staff';

                if (user.role !== 'contributor') {
                    finalAssignedAgentId = user.uid;
                    finalAssignedAgentEmail = user.email || '';
                    finalAssignedAgentName = user.displayName || user.email || 'Staff';
                } else if (targetTaxpayer) {
                    finalAssignedAgentId = targetTaxpayer.assignedAgentId || 'global';
                    finalAssignedAgentEmail = (targetTaxpayer as any).assignedAgentEmail || 'global';
                    finalAssignedAgentName = targetTaxpayer.assignedAgentName || 'Staff';
                }

                const convRef = await addDoc(collection(db, 'conversations'), {
                    participants: currentParticipants,
                    contributorId,
                    agentId: user.role !== 'contributor' ? user.uid : 'global',
                    assignedAgentId: finalAssignedAgentId,
                    assignedAgentEmail: finalAssignedAgentEmail,
                    assignedAgentName: finalAssignedAgentName,
                    subject: finalSubject,
                    lastUpdate: serverTimestamp(),
                    lastMessagePreview: finalBody.substring(0, 100),
                    isReadByContributor: user.role === 'contributor',
                    isReadByDGI: user.role !== 'contributor',
                    status: 'open',
                    companyName: targetTaxpayer?.companyName || targetTaxpayer?.displayName || 'Inconnu',
                    contributorName: targetTaxpayer?.displayName || '',
                    taxNumber: targetTaxpayer?.taxNumber || ''
                });
                conversationId = convRef.id;
            } else {
                await updateDoc(doc(db, 'conversations', conversationId), {
                    lastUpdate: serverTimestamp(),
                    lastMessagePreview: finalBody.substring(0, 100),
                    isReadByContributor: user.role === 'contributor',
                    isReadByDGI: user.role !== 'contributor',
                });
            }

            // 3. Add message
            await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
                body: finalBody,
                participants: currentParticipants,
                senderId: user.uid,
                senderName: user.displayName || user.email,
                receiverId: composeData.receiverId,
                attachments: finalAttachments,
                hasAttachments: finalAttachments.length > 0,
                createdAt: serverTimestamp(),
                conversationId: conversationId
            });

            if (finalAttachments.length > 0) {
                await updateDoc(doc(db, 'conversations', conversationId), {
                    hasAttachments: true
                });
            }

            resetCompose();
            setStatus('Transmission réussie');
        } catch (e: any) {
            console.error('Final transmission error', e);
            alert(`Erreur de transmission: ${e.message}`);
            setUploading(false);
            setStatus('');
        }
    };

    const handleReply = (conv: Conversation) => {
        const otherParticipant = conv.participants.find(p => p !== user?.uid) || 'admin_dgi';
        setComposeData({
            receiverId: otherParticipant,
            subject: conv.subject,
            body: "", 
            searchTaxpayer: '',
            conversationId: conv.id
        });
        setIsComposeOpen(true);
        setSelectedConv(null);
    };

    const confirmDelete = (conv: Conversation) => {
        setConvToDelete(conv);
        setIsDeleteConfirmOpen(true);
    };

    const deleteConversation = async () => {
        if (!user || !convToDelete || !hasPermission(user, 'deletion')) return;
        setDeleting(true);
        try {
            await deleteDoc(doc(db, 'conversations', convToDelete.id));
            setIsDeleteConfirmOpen(false);
            setSelectedConv(null);
            setConvToDelete(null);
        } catch (e: any) {
            alert("Erreur de suppression: " + e.message);
        } finally {
            setDeleting(false);
        }
    };

    const removeAttachment = (index: number) => {
        // Cancel the actual firebase task if it's still running
        const task = uploadTasksRef.current.get(index);
        if (task && typeof task.cancel === 'function') {
            try { task.cancel(); } catch (e) { /* ignore */ }
        }
        uploadTasksRef.current.delete(index);
        
        setAttachments(prev => prev.filter((_, i) => i !== index));
        setUploadProgress(prev => prev.filter((_, i) => i !== index));
        setUploadedFiles(prev => prev.filter((_, i) => i !== index));
        setUploadErrors(prev => prev.filter((_, i) => i !== index));
        // Also clear the promise tracking
        uploadPromisesRef.current.delete(index);
    };

    const handleTransfer = async (agentUid: string) => {
        if (!selectedConv) return;
        const targetAgentObj = agents.find(a => a.uid === agentUid);
        const agentEmail = targetAgentObj?.email || '';
        const agentName = targetAgentObj?.displayName || '';

        await updateDoc(doc(db, 'conversations', selectedConv.id), {
            agentId: agentUid,
            assignedAgentId: agentUid,
            assignedAgentEmail: agentEmail,
            assignedAgentName: agentName,
            participants: [selectedConv.contributorId, agentUid]
        });
        setIsTransferOpen(false);
        setSelectedConv(null);
    };

    const filteredConversations = conversations.filter(c => 
        (c.companyName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.taxNumber?.includes(searchTerm)
    );

    const handleSelectConv = async (c: Conversation) => {
        setSelectedConv(c);
        if (user?.role === 'contributor' && !c.isReadByContributor) {
            await updateDoc(doc(db, 'conversations', c.id), { isReadByContributor: true });
        } else if (user?.role !== 'contributor' && !c.isReadByDGI) {
            await updateDoc(doc(db, 'conversations', c.id), { isReadByDGI: true });
        }
    };

    const filteredTaxpayers = taxpayers.filter(t => 
        t.displayName.toLowerCase().includes(composeData.searchTaxpayer.toLowerCase()) ||
        t.companyName?.toLowerCase().includes(composeData.searchTaxpayer.toLowerCase()) ||
        t.taxNumber?.includes(composeData.searchTaxpayer)
    );

    return (
        <div className="flex-1 flex flex-col bg-[#F4F7F6] overflow-hidden font-sans">
            <header className="p-6 md:p-10 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-xl md:text-3xl font-black text-[#2C3E50] tracking-tighter italic uppercase">Messagerie</h1>
                    <p className="text-[7px] md:text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-1 opacity-60">Flux de communication sécurisé DGI</p>
                </div>
                <div className="flex items-center gap-3 md:gap-6">
                    {status && (
                        <div className="px-4 py-2 bg-primary/10 text-primary text-[8px] md:text-[10px] font-black rounded-xl border border-primary/20 animate-in fade-in slide-in-from-right duration-300">
                            {status}
                        </div>
                    )}
                    <div className="relative group hidden lg:block w-72">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 group-focus-within:text-primary transition-colors" size={16} />
                        <input 
                            placeholder="Filtrer les échanges..." 
                            className="w-full pl-12 pr-4 py-3 bg-[#F4F7F6] border border-transparent rounded-2xl text-[9px] font-black uppercase tracking-widest outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all shadow-inner"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <button 
                        onClick={() => setIsComposeOpen(true)}
                        className="px-6 py-3 md:px-10 md:py-4 bg-primary text-white rounded-xl md:rounded-[1.5rem] font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 md:gap-4"
                    >
                        <Plus size={18} /> <span className="hidden sm:inline">Nouveau Message</span><span className="sm:hidden">Nouveau</span>
                    </button>
                </div>
            </header>

            <div className="flex-1 p-4 md:p-10 overflow-hidden">
                <div className="bg-white rounded-2xl md:rounded-[3.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5 h-full flex flex-col overflow-hidden">
                    <div className="overflow-auto flex-1 scrollbar-hide">
                        {/* Mobile view cards */}
                        <div className="md:hidden divide-y divide-gray-50">
                            {filteredConversations.length === 0 ? (
                                <div className="py-24 text-center opacity-20">
                                    <Mail size={48} className="mx-auto mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Aucune Conversation</p>
                                </div>
                            ) : (
                                filteredConversations.map(c => (
                                    <div 
                                        key={c.id} 
                                        onClick={() => handleSelectConv(c)}
                                        className="p-4 active:bg-gray-50 transition-colors flex items-start gap-4 relative"
                                    >
                                        {((user?.role === 'contributor' && !c.isReadByContributor) || (user?.role !== 'contributor' && !c.isReadByDGI)) && (
                                            <div className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-primary rounded-full animate-pulse shadow-sm shadow-primary/50" />
                                        )}
                                        <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-black shrink-0 uppercase">
                                            {(c.companyName || c.subject)[0]}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-1">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <h4 className="text-xs font-black truncate uppercase tracking-tight text-[#2C3E50]">{c.companyName || 'DGI'}</h4>
                                                    {(c as any).hasAttachments && <Paperclip size={10} className="text-primary shrink-0" />}
                                                </div>
                                                <span className="text-[8px] font-black text-gray-400 whitespace-nowrap">{c.lastUpdate?.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
                                            </div>
                                            <p className="text-[10px] font-black text-gray-600 truncate mb-1">{c.subject}</p>
                                            <p className="text-[9px] text-gray-400 truncate italic">{c.lastMessagePreview}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop view table */}
                        <table className="hidden md:table w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50/50 border-b border-gray-100 sticky top-0 z-10 backdrop-blur-md">
                                    <th className="px-10 py-6 text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] w-[30%]">Sujet / Contribuable</th>
                                    <th className="px-10 py-6 text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] w-[45%]">Dernier Message</th>
                                    <th className="px-10 py-6 text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] text-right">Dernière activité</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {filteredConversations.map(c => (
                                    <tr 
                                        key={c.id} 
                                        onClick={() => handleSelectConv(c)}
                                        className={cn(
                                            "group cursor-pointer hover:bg-primary/5 transition-all text-sm relative",
                                            selectedConv?.id === c.id ? "bg-primary/5" : ""
                                        )}
                                    >
                                        <td className="px-10 py-7 relative">
                                            {((user?.role === 'contributor' && !c.isReadByContributor) || (user?.role !== 'contributor' && !c.isReadByDGI)) && (
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary rounded-full animate-pulse shadow-md shadow-primary/50" />
                                            )}
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-primary font-black uppercase shadow-inner">
                                                    {(c.companyName || c.subject)[0]}
                                                </div>
                                                <div className="flex flex-col min-w-0 pr-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-black text-[#2C3E50] group-hover:text-primary transition-colors uppercase tracking-tight truncate">{c.subject}</span>
                                                        {(c as any).hasAttachments && <Paperclip size={12} className="text-primary shrink-0" />}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-[10px] h-[14px] text-primary font-black uppercase tracking-tighter truncate">{c.companyName || 'DGI'}</span>
                                                        <span className="text-[8px] text-gray-400 font-bold opacity-60 truncate">
                                                            {c.contributorName && `${c.contributorName} • `}{c.taxNumber && `NIU: ${c.taxNumber}`}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-10 py-7">
                                            <p className="text-[11px] text-gray-500 font-medium truncate max-w-md italic">{c.lastMessagePreview}</p>
                                        </td>
                                        <td className="px-10 py-7 text-right">
                                            <span className="text-[10px] text-gray-400 font-black tabular-nums border border-gray-100 px-3 py-1 rounded-full uppercase">
                                                {c.lastUpdate?.toDate() ? c.lastUpdate.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Compose Modal */}
            {isComposeOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-[4rem] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-white relative">
                        <header className="p-8 md:p-12 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-4 md:gap-6">
                                <div className="w-10 h-10 md:w-14 md:h-14 bg-primary text-white rounded-xl md:rounded-[1.5rem] flex items-center justify-center shadow-2xl shadow-primary/20">
                                    <Send size={20} />
                                </div>
                                <h3 className="text-xl md:text-3xl font-black text-[#2C3E50] uppercase tracking-tighter leading-none italic">Nouvel Échange</h3>
                            </div>
                            <button onClick={resetCompose} className="p-3 md:p-4 bg-gray-50 text-gray-400 hover:text-primary rounded-xl md:rounded-2xl transition-all shadow-inner"><X size={20} /></button>
                        </header>
                        
                        <div className="flex-1 overflow-y-auto p-6 md:p-12 bg-gray-50/50 flex flex-col lg:flex-row gap-8 md:gap-12">
                            <div className="flex-1 space-y-6 md:space-y-8">
                                {!composeData.conversationId && (user?.role === 'admin' || user?.role === 'agent') ? (
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Sélection du Contribuable</label>
                                        <div className="relative">
                                            <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                                            <input 
                                                className="w-full pl-14 md:pl-16 pr-6 py-4 md:py-5 bg-white border border-gray-100 rounded-2xl md:rounded-3xl outline-none focus:ring-4 focus:ring-primary/5 transition-all text-[11px] md:text-sm font-bold shadow-xl shadow-gray-500/5"
                                                placeholder="Recherche par Nom, Société ou NIU..."
                                                value={composeData.searchTaxpayer}
                                                onChange={e => setComposeData(p => ({ ...p, searchTaxpayer: e.target.value }))}
                                            />
                                            {composeData.searchTaxpayer && !composeData.receiverId.startsWith('t-') && (
                                                <div className="absolute top-full left-0 right-0 mt-2 md:mt-4 bg-white border border-gray-100 rounded-[1.5rem] md:rounded-3xl shadow-2xl z-20 max-h-48 md:max-h-60 overflow-y-auto p-4 space-y-2">
                                                    {filteredTaxpayers.map(t => (
                                                        <button 
                                                            key={t.uid}
                                                            onClick={() => setComposeData(p => ({ ...p, receiverId: t.uid, searchTaxpayer: `${t.companyName || t.displayName} (${t.taxNumber})` }))}
                                                            className="w-full text-left p-3 md:p-4 hover:bg-gray-50 rounded-xl md:rounded-2xl transition-all flex items-center justify-between group"
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="text-xs md:text-sm font-black text-[#2C3E50] group-hover:text-primary transition-colors">{t.companyName || t.displayName}</span>
                                                                <span className="text-[8px] md:text-[10px] text-gray-400 font-bold uppercase tracking-widest">{t.taxNumber}</span>
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Destinataire (Fil de discussion)</label>
                                        <div className="flex items-center gap-4 p-4 md:p-6 bg-white border border-primary/20 rounded-2xl md:rounded-[2rem] shadow-sm">
                                            <div className="w-8 h-8 md:w-10 md:h-10 bg-primary/10 text-primary rounded-xl flex items-center justify-center font-black">
                                                {user?.role === 'contributor' ? <Shield size={16} /> : <User size={16} />}
                                            </div>
                                            <div>
                                                <p className="text-[11px] md:text-xs font-black text-[#2C3E50] uppercase tracking-tighter italic leading-none mb-1">
                                                    {user?.role === 'contributor' ? "Direction Générale des Impôts" : (selectedConv?.companyName || "Contribuable")}
                                                </p>
                                                <p className="text-[8px] md:text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none">
                                                    {user?.role === 'contributor' ? "Cellule Nationale de Traitement" : (selectedConv?.taxNumber || "Profil Certifié")}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Objet du Message</label>
                                    <input 
                                        className="w-full px-6 py-4 md:px-8 md:py-5 bg-white border border-gray-100 rounded-2xl md:rounded-3xl outline-none focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-xl shadow-gray-500/5 placeholder:italic disabled:opacity-50"
                                        placeholder="Ex: Demande d'exonération..."
                                        value={composeData.subject}
                                        onChange={e => setComposeData(p => ({ ...p, subject: e.target.value }))}
                                        disabled={!!composeData.conversationId}
                                    />
                                    {composeData.conversationId && (
                                        <p className="text-[8px] font-bold text-primary uppercase ml-2 tracking-widest opacity-60 italic">Sujet lié au fil de discussion existant</p>
                                    )}
                                </div>

                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Détails de la Transmission</label>
                                    <textarea 
                                        className="w-full px-6 py-6 md:px-8 md:py-8 bg-white border border-gray-100 rounded-[1.5rem] md:rounded-[2.5rem] outline-none focus:ring-4 focus:ring-primary/5 transition-all text-sm font-medium shadow-xl shadow-gray-500/5 min-h-[150px] md:min-h-[200px] leading-relaxed resize-none"
                                        placeholder="Décrivez votre requête..."
                                        value={composeData.body}
                                        onChange={e => setComposeData(p => ({ ...p, body: e.target.value }))}
                                    />
                                </div>
                            </div>

                            <div className="md:w-72 space-y-8">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Pièces Jointes (Max 10)</label>
                                    
                                    <div className="space-y-3 max-h-72 overflow-y-auto pr-2 scrollbar-hide py-2">
                                            {attachments.map((file, idx) => {
                                                const isImg = file.type.startsWith('image/');
                                                const isPdf = file.type === 'application/pdf';
                                                const previewUrl = (isImg || isPdf) ? URL.createObjectURL(file) : null;
                                                
                                                return (
                                                    <div key={idx} className="flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm animate-in zoom-in duration-300 relative group">
                                                        <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center shrink-0 shadow-inner overflow-hidden border border-gray-100">
                                                            {isImg ? (
                                                                <img src={previewUrl!} className="w-full h-full object-cover" alt="Preview" />
                                                            ) : isPdf ? (
                                                                <FileText size={20} className="text-primary" />
                                                            ) : (
                                                                <FileText size={20} className="text-gray-300" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2 overflow-hidden">
                                                                <p className="text-[10px] font-black text-[#2C3E50] truncate">{file.name}</p>
                                                                {uploadedFiles[idx] ? (
                                                                    <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                                                                ) : uploadErrors[idx] ? (
                                                                    <AlertCircle size={14} className="text-red-500 shrink-0" title={uploadErrors[idx]!} />
                                                                ) : (
                                                                    <span className="text-[9px] font-black text-primary animate-pulse">{Math.round(uploadProgress[idx] || 5)}%</span>
                                                                )}
                                                            </div>
                                                            {!uploadedFiles[idx] && (
                                                                <div className="w-full h-1 bg-gray-50 rounded-full mt-1.5 overflow-hidden border border-gray-100/50">
                                                                    <div 
                                                                        className={`h-full transition-all duration-300 ease-out font-black ${uploadErrors[idx] ? 'bg-red-400' : 'bg-primary'}`}
                                                                        style={{ width: `${Math.max(5, uploadProgress[idx] || 0)}%` }}
                                                                    />
                                                                </div>
                                                            )}
                                                            {uploadErrors[idx] && (
                                                                <p className="text-[7px] text-red-500 font-bold uppercase mt-1 leading-none">Échec de transmission</p>
                                                            )}
                                                            <p className="text-[8px] text-gray-400 font-bold uppercase tracking-widest mt-1">{(file.size / 1024).toFixed(0)} KB • {file.type.split('/')[1]?.toUpperCase() || 'DOCUMENT'}</p>
                                                        </div>
                                                                    <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                                                        <button 
                                                                            onClick={() => setFileToView({ url: uploadedFiles[idx]?.url || previewUrl!, name: file.name, type: file.type })}
                                                                            className="p-1.5 bg-white/90 backdrop-blur shadow-sm rounded-lg text-primary hover:bg-white transition-all disabled:opacity-50"
                                                                            title="Lire le fichier"
                                                                            disabled={!previewUrl && !uploadedFiles[idx]?.url}
                                                                        >
                                                                            <Eye size={12} />
                                                                        </button>
                                                                        <button 
                                                                            onClick={() => removeAttachment(idx)} 
                                                                            className="p-1.5 bg-red-50/90 backdrop-blur shadow-sm rounded-lg text-red-400 hover:text-red-600 transition-all"
                                                                            title="Supprimer"
                                                                        >
                                                                            <Trash2 size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>

                                    <div className="relative group">
                                        <input 
                                            type="file" 
                                            multiple
                                            disabled={uploading}
                                            className="hidden" 
                                            id="attachment" 
                                            onChange={async (e) => {
                                                const files = Array.from(e.target.files || []) as File[];
                                                const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
                                                const MAX_SIZE = 5 * 1024 * 1024;
                                                const valid = files.filter(f => {
                                                    if (f.size > MAX_SIZE) { alert(`Fichier ${f.name} trop large (Max 5Mo)`); return false; }
                                                    if (!allowedTypes.includes(f.type)) { alert(`Format ${f.name} non supporté`); return false; }
                                                    return true;
                                                });
                                                if (attachments.length + valid.length > 10) { 
                                                    alert("Max 10 fichiers"); 
                                                    return; 
                                                }
                                                
                                                const startIndex = attachments.length;
                                                setAttachments(prev => [...prev, ...valid]);
                                                setUploadProgress(prev => [...prev, ...valid.map(() => 5)]);
                                                setUploadedFiles(prev => [...prev, ...valid.map(() => null)]);
                                                setUploadErrors(prev => [...prev, ...valid.map(() => null)]);

                                                // Background Management: Use specific promise tracking to avoid double-compression/upload
                                                valid.forEach((file, idx) => {
                                                    const targetIdx = startIndex + idx;
                                                    
                                                    const uploadPromise = uploadFile(file, `conversations/${user.uid}`, (p) => {
                                                        setUploadProgress(curr => {
                                                            const cp = [...curr];
                                                            if (cp[targetIdx] !== undefined) cp[targetIdx] = p;
                                                            return cp;
                                                        });
                                                    }, (task) => {
                                                        uploadTasksRef.current.set(targetIdx, task);
                                                    }).then(url => {
                                                        const result: Attachment = { 
                                                            url, 
                                                            name: file.name, 
                                                            type: file.type,
                                                            size: file.size,
                                                            createdAt: new Date().toISOString()
                                                        };
                                                        
                                                        setUploadedFiles(curr => {
                                                            const cp = [...curr];
                                                            if (cp[targetIdx] !== undefined) cp[targetIdx] = result;
                                                            return cp;
                                                        });
                                                        
                                                        return result;
                                                    }).catch(err => {
                                                        console.error("Critical transmission failure", err);
                                                        setUploadErrors(curr => {
                                                            const cp = [...curr];
                                                            if (cp[targetIdx] !== undefined) cp[targetIdx] = "Échec";
                                                            return cp;
                                                        });
                                                        throw err;
                                                    });

                                                    uploadPromisesRef.current.set(targetIdx, uploadPromise);
                                                });
                                            }} 
                                        />
                                        <label 
                                            htmlFor="attachment"
                                            className="flex flex-col items-center justify-center p-8 bg-white border-2 border-dashed border-gray-100 rounded-[2.5rem] shadow-xl shadow-gray-500/5 cursor-pointer hover:border-primary/20 hover:bg-primary/5 transition-all group overflow-hidden"
                                        >
                                            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 transition-colors group-hover:bg-white text-gray-300 group-hover:text-primary shadow-inner">
                                                <UploadCloud size={24} />
                                            </div>
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-center px-4">Glisser ou Sélectionner</p>
                                        </label>
                                    </div>
                                </div>

                                <div className="p-8 bg-primary rounded-[2.5rem] text-white shadow-2xl shadow-primary/20 relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl -mr-12 -mt-12" />
                                    <ShieldCheck size={32} className="mb-4 opacity-30" />
                                    <h4 className="text-lg font-black uppercase tracking-tighter italic leading-none mb-2 text-white">Sécurité Forte</h4>
                                    <p className="text-[10px] text-red-50/70 font-medium leading-relaxed">
                                        Communications cryptées et historisées V3.2 via protocole DGI-SECURE.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <footer className="p-10 border-t border-gray-100 bg-white flex items-center justify-center gap-6 shrink-0">
                            <button 
                                onClick={resetCompose}
                                className="px-10 py-5 bg-gray-50 text-gray-400 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-gray-100 mr-auto"
                            >
                                Annuler
                            </button>
                            <button 
                                onClick={handleSend}
                                disabled={uploading || !composeData.subject || !composeData.body || (attachments.length > 0 && uploadedFiles.filter(Boolean).length < attachments.length)}
                                className="px-16 py-5 bg-primary text-white font-black text-[10px] uppercase tracking-[0.3em] rounded-2xl shadow-2xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-30 flex items-center gap-4"
                            >
                                {uploading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        <span className="animate-pulse">{status || "Initialisation..."}</span>
                                    </div>
                                ) : (
                                    <>
                                        <span>{user?.role === 'contributor' ? "Transmettre à la DGI" : "Répondre au Contribuable"}</span>
                                        <Send size={16} />
                                    </>
                                )}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {/* Read Modal (Conversational View) */}
            {selectedConv && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in zoom-in duration-300">
                    <div className="bg-white rounded-[3rem] md:rounded-[4rem] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-white">
                        <header className="p-8 md:p-12 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/30">
                            <div className="flex items-center gap-4 md:gap-6">
                                <div className="w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-[1.5rem] bg-primary text-white flex items-center justify-center text-xl md:text-2xl font-black italic shadow-2xl shadow-primary/20">
                                    {(selectedConv.companyName || selectedConv.subject)[0]}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xl md:text-2xl font-black text-[#2C3E50] uppercase tracking-tighter leading-none truncate">{selectedConv.subject}</h3>
                                    <p className="text-[9px] md:text-[10px] font-black text-primary uppercase tracking-[0.2em] mt-2 opacity-70 truncate">{selectedConv.companyName || 'Direction Générale des Impôts'}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedConv(null)} className="p-3 md:p-4 bg-white text-gray-300 hover:text-primary rounded-xl md:rounded-2xl transition-all shadow-xl shadow-gray-500/5 border border-gray-50"><X size={24} /></button>
                        </header>
                        
                        <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-[#F4F7F6]/30 space-y-8">
                            {messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-64 opacity-20">
                                    <RefreshCw className="animate-spin mb-4" />
                                    <p className="font-black uppercase tracking-widest text-[10px]">Chargement des archives...</p>
                                </div>
                            ) : (
                                messages.map((msg, idx) => {
                                    const isMe = msg.senderId === user?.uid;
                                    
                                    return (
                                        <div key={msg.id || idx} className={cn(
                                            "flex flex-col animate-in fade-in slide-in-from-bottom duration-500",
                                            isMe ? "items-end" : "items-start"
                                        )} style={{ animationDelay: `${idx * 100}ms` }}>
                                             <div className="flex items-center gap-2 mb-2 px-2 opacity-60">
                                                {isMe ? <ArrowUpRight size={10} className="text-primary" /> : <ArrowDownLeft size={10} className="text-gray-400" />}
                                                <span className="text-[8px] font-black uppercase tracking-widest leading-none">{msg.senderName}</span>
                                            </div>
                                            <div className={cn(
                                                "max-w-[90%] md:max-w-[80%] p-6 md:p-8 rounded-[2rem] shadow-sm relative group transition-all",
                                                isMe 
                                                    ? "bg-red-50 text-[#2C3E50] border border-red-100 rounded-tr-none" 
                                                    : "bg-gray-100 text-[#2C3E50] border border-gray-200 rounded-tl-none"
                                            )}>
                                                <div className="flex flex-col gap-3">
                                                    <p className="text-xs md:text-sm font-medium leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                                                </div>
                                                
                                                {msg.attachments && msg.attachments.length > 0 && (
                                                    <div className={cn("mt-6 pt-6 border-t grid grid-cols-1 sm:grid-cols-2 gap-4", isMe ? "border-white/10" : "border-gray-100")}>
                                                        {msg.attachments.map((att: Attachment, aIdx: number) => {
                                                            const isImg = att.type?.startsWith('image/');
                                                            return (
                                                                <div 
                                                                    key={aIdx} 
                                                                    className="flex flex-col gap-3 p-5 bg-white border border-gray-100 rounded-[2rem] shadow-sm hover:shadow-md transition-all relative group w-full"
                                                                >
                                                                    {isImg ? (
                                                                        <div className="w-full aspect-video rounded-2xl overflow-hidden border border-gray-50 bg-gray-50 mb-2">
                                                                            <img 
                                                                                src={att.url} 
                                                                                className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform" 
                                                                                alt="Preview" 
                                                                                referrerPolicy="no-referrer"
                                                                                onClick={() => setFileToView(att)}
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-4 bg-gray-50/50 p-4 rounded-2xl border border-gray-100">
                                                                            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center shrink-0 shadow-inner">
                                                                                <FileText size={24} />
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <p className="text-[10px] font-black text-[#2C3E50] truncate uppercase tracking-tight">{att.name}</p>
                                                                                <p className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">{att.type?.split('/')[1]?.toUpperCase() || 'DOCUMENT'}</p>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                    
                                                                    <div className="flex items-center gap-3 mt-2">
                                                                        <button 
                                                                            onClick={() => setFileToView(att)}
                                                                            className="flex-1 flex items-center justify-center gap-2 py-3 bg-primary/5 text-primary text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-primary/10 transition-colors"
                                                                        >
                                                                            <Eye size={14} /> Consulter
                                                                        </button>
                                                                        <a 
                                                                            href={att.url}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            className="flex items-center justify-center gap-2 py-3 px-4 bg-gray-100 text-gray-500 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-colors"
                                                                        >
                                                                            <Download size={14} />
                                                                        </a>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <span className={cn(
                                                    "absolute bottom-[-20px] text-[8px] font-bold uppercase tracking-widest opacity-40 whitespace-nowrap",
                                                    isMe ? "right-2" : "left-2"
                                                )}>
                                                    {msg.createdAt?.toDate().toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <footer className="p-6 md:p-10 border-t border-gray-100 bg-gray-50/30 flex flex-wrap items-center justify-center gap-3 md:gap-6 shrink-0">
                             <button 
                                onClick={() => setSelectedConv(null)}
                                className="px-6 py-3 md:px-10 md:py-4 bg-white border border-gray-100 text-gray-400 font-black text-[9px] md:text-[10px] uppercase tracking-widest rounded-xl md:rounded-2xl hover:bg-gray-50 transition-all flex items-center gap-2"
                            >
                                <X size={14} className="sm:hidden" /> Fermer
                            </button>

                            <button 
                                onClick={() => handleReply(selectedConv)}
                                className="px-6 py-3 md:px-10 md:py-4 bg-primary text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest rounded-xl md:rounded-2xl shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
                            >
                                <Send size={14} /> Répondre
                            </button>

                            {(user?.role === 'admin' || user?.role === 'agent') && (
                                <button 
                                    onClick={() => setIsTransferOpen(true)}
                                    className="px-6 py-3 md:px-10 md:py-4 bg-white border border-primary/20 text-primary font-black text-[9px] md:text-[10px] uppercase tracking-widest rounded-xl md:rounded-2xl shadow-xl shadow-primary/5 hover:bg-primary/5 transition-all flex items-center gap-2"
                                >
                                    <ArrowRightLeft size={14} />
                                    <span className="hidden sm:inline">Transférer</span>
                                </button>
                            )}

                            {(user?.role === 'admin' || user?.role === 'agent') && (
                                <button 
                                    onClick={() => {
                                        if (selectedConv?.agentId && selectedConv.agentId !== user.uid) {
                                            const agent = agents.find(a => a.uid === selectedConv.agentId);
                                            if (agent) navigate('/internal', { state: { targetAgent: agent } });
                                            else navigate('/internal');
                                        } else {
                                            navigate('/internal');
                                        }
                                    }}
                                    className="px-6 py-3 md:px-10 md:py-4 bg-red-600 text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest rounded-xl md:rounded-2xl shadow-xl shadow-red-200 hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
                                >
                                    <MessageSquare size={14} /> <span className="hidden sm:inline">Canal</span> DGI
                                </button>
                            )}

                            {hasPermission(user, 'deletion') && (
                                <button 
                                    onClick={() => confirmDelete(selectedConv)}
                                    className="px-3 md:px-4 py-3 md:py-4 bg-red-50 text-red-600 font-black text-[10px] rounded-xl md:rounded-2xl hover:bg-red-100 transition-all ml-auto"
                                    title="Supprimer la conversation"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </footer>
                    </div>
                </div>
            )}

            {/* Confirm Delete Modal */}
            <ConfirmModal 
                isOpen={isDeleteConfirmOpen} 
                onClose={() => setIsDeleteConfirmOpen(false)} 
                onConfirm={deleteConversation}
                loading={deleting}
                title="Suppression de Conversation"
                message="Êtes-vous sûr de vouloir supprimer TOUTE la conversation ? Cette action effacera l'historique complet et les fichiers associés. Cette action est irréversible."
            />

            {/* Transfer Modal */}
            {isTransferOpen && selectedConv && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-[4rem] w-full max-w-lg shadow-2xl border border-white overflow-hidden p-12">
                        <header className="text-center mb-10">
                            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                                <ArrowRightLeft size={32} />
                            </div>
                            <h3 className="text-2xl font-black text-[#2C3E50] uppercase tracking-tighter italic">Affectation de Dossier</h3>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.2em] mt-2 leading-relaxed">Transférer la gestion de cet échange à un agent spécifique pour traitement approfondi.</p>
                        </header>
                        
                        <div className="space-y-4 mb-10">
                            {agents.map(a => (
                                <button 
                                    key={a.uid}
                                    onClick={() => handleTransfer(a.uid)}
                                    className="w-full flex items-center justify-between p-6 bg-gray-50 border border-transparent hover:border-blue-200 hover:bg-white rounded-[1.5rem] transition-all group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-white text-blue-600 flex items-center justify-center shadow-sm font-black uppercase text-sm">{a.displayName[0]}</div>
                                        <span className="text-sm font-black text-[#2C3E50] group-hover:text-blue-600 transition-colors">{a.displayName}</span>
                                    </div>
                                    <Plus size={18} className="text-gray-300 group-hover:text-blue-600" />
                                </button>
                            ))}
                        </div>

                        <button 
                            onClick={() => setIsTransferOpen(false)}
                            className="w-full py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-primary transition-colors"
                        >
                            Annuler l'Opération
                        </button>
                    </div>
                </div>
            )}

            {/* File Viewer Modal */}
            {fileToView && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/90 backdrop-blur-xl p-4 md:p-8 animate-in fade-in duration-300">
                    <div className="bg-white rounded-[4rem] w-full max-w-5xl h-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden relative border border-white/20">
                        <header className="p-8 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-primary/10 text-primary rounded-xl">
                                    {fileToView.type?.startsWith('image/') ? <Image size={24} /> : <FileText size={24} />}
                                </div>
                                <div>
                                    <h3 className="text-xl font-black text-[#2C3E50] tracking-tighter leading-none mb-1 uppercase italic">{fileToView.name}</h3>
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{fileToView.type}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <a 
                                    href={fileToView.url} 
                                    download={fileToView.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-6 py-3 bg-gray-50 text-gray-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-primary hover:text-white transition-all shadow-sm flex items-center gap-2"
                                >
                                    <Download size={14} /> Télécharger
                                </a>
                                <button 
                                    onClick={() => setFileToView(null)} 
                                    className="p-4 bg-gray-50 text-gray-400 hover:text-red-500 rounded-xl transition-all shadow-inner"
                                >
                                    <X size={24} />
                                </button>
                            </div>
                        </header>
                        
                        <div className="flex-1 bg-gray-50 overflow-auto p-4 md:p-12 flex items-center justify-center relative">
                            {fileToView.type?.startsWith('image/') ? (
                                <img 
                                    src={fileToView.url} 
                                    className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl" 
                                    alt={fileToView.name}
                                    referrerPolicy="no-referrer"
                                />
                            ) : fileToView.type === 'application/pdf' ? (
                                <iframe 
                                    key={fileToView.url}
                                    src={fileToView.url} 
                                    className="w-full h-full rounded-2xl shadow-2xl bg-white border-0" 
                                    title={fileToView.name}
                                />
                            ) : (
                                <div className="text-center space-y-4 p-12 bg-white rounded-[3rem] shadow-xl border border-gray-100 max-w-md">
                                    <div className="w-24 h-24 bg-primary/10 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                        <AlertCircle size={48} />
                                    </div>
                                    <h4 className="text-2xl font-black text-[#2C3E50] uppercase tracking-tighter italic">Aperçu indisponible</h4>
                                    <p className="text-sm text-gray-500 font-medium">Le format de ce fichier ne supporte pas l'aperçu direct. Veuillez le télécharger pour le consulter.</p>
                                    <a 
                                        href={fileToView.url} 
                                        target="_blank" 
                                        rel="noreferrer"
                                        className="inline-block px-8 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-105 transition-all"
                                    >
                                        Ouvrir dans un nouvel onglet
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const SettingsPage = () => {
    const { theme, updateTheme } = useTheme();
    const { user, isAdminMode } = useAuth();
    const navigate = useNavigate();
    const [status, setStatus] = useState('');
    const [agents, setAgents] = useState<AppUser[]>([]);
    const [uploading, setUploading] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    
    const [agentForm, setAgentForm] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        tempPassword: 'Dgi2026!',
        role: 'agent' as UserRole,
        permissions: [] as AgentPermission[]
    });

    useEffect(() => {
        if (user?.role === 'admin' && isAdminMode) {
            const q = query(collection(db, 'users'), or(where('role', '==', 'agent'), where('role', '==', 'admin')));
            return onSnapshot(q, 
                (snap) => setAgents(snap.docs.map(d => ({ uid: d.id, ...d.data() } as unknown as AppUser))),
                (err) => handleFirestoreError(err, OperationType.LIST, 'settings_agents')
            );
        }
    }, [user, isAdminMode]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'favicon') => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        const fieldName = type === 'logo' ? 'logoUrl' : 'faviconUrl';
        reader.onload = (event) => {
            const base64 = event.target?.result as string;
            updateTheme({ [fieldName]: base64 }, true); 
        };
        reader.readAsDataURL(file);
        
        setUploading(type);
        try {
            const compressedFile = await compressBrandingImage(file, type);
            const url = await uploadFile(compressedFile, `branding/${type}`);
            await updateTheme({ [fieldName]: url });
            setStatus(`Identité ${type === 'logo' ? 'visuelle' : 'navigateur'} centralisée !`);
        } catch (err: any) {
            console.error(err);
            setStatus('Erreur de synchronisation cloud');
        } finally {
            setUploading(null);
            setTimeout(() => setStatus(''), 3000);
        }
    };

    const handleCreateAgent = async () => {
        if (!agentForm.email.trim() || !user) return;
        setLoading(true);
        try {
            const tempPass = agentForm.tempPassword || 'Dgi2026!';
            const displayName = `${agentForm.firstName} ${agentForm.lastName}`.trim();
            
            const newUser: Partial<AppUser> = {
                email: agentForm.email.toLowerCase().trim(),
                displayName: displayName || 'Nouvel Agent',
                phone: agentForm.phone,
                role: agentForm.role,
                permissions: agentForm.permissions,
                isActive: true, // "active: true" mapped to isActive
                isFirstLogin: true,
                isNew: true, // Requested field
                isSetup: true,
                assignedContribuables: [], // Requested field
                internalPassword: tempPass,
                lastLogin: null
            };

            const agentRef = await addDoc(collection(db, 'users'), newUser);
            
            // Sync to dedicated agents collection for dual-role detection
            await setDoc(doc(db, 'agents', agentRef.id), {
                email: newUser.email,
                role: newUser.role,
                displayName: newUser.displayName,
                uid: agentRef.id,
                password: tempPass,
                isNew: true
            });
            
            setAgentForm({ firstName: '', lastName: '', email: '', phone: '', tempPassword: 'Dgi2026!', role: 'agent', permissions: [] });
            setStatus(`Profil Agent créé : ${agentForm.email}. Code d'activation temporaire: ${tempPass}.`);
        } catch (e) {
            console.error(e);
            setStatus("Erreur lors de la création");
        } finally {
            setLoading(false);
            setTimeout(() => setStatus(''), 4000);
        }
    };

    const [editingAgent, setEditingAgent] = useState<AppUser | null>(null);
    const [editAgentPassword, setEditAgentPassword] = useState('');
    const [editAgentIsNew, setEditAgentIsNew] = useState(false);
    const [viewingAgentProfile, setViewingAgentProfile] = useState<AppUser | null>(null);
    const [attributingAgent, setAttributingAgent] = useState<AppUser | null>(null);
    const [allTaxpayers, setAllTaxpayers] = useState<AppUser[]>([]);
    const [taxpayerSearch, setTaxpayerSearch] = useState('');

    const openEditAgent = async (agent: AppUser) => {
        setLoading(true);
        try {
            const agentsRef = collection(db, 'agents');
            const agentSnap = await getDocs(query(agentsRef, where('email', '==', agent.email.toLowerCase().trim())));
            let password = '';
            let isNew = true;
            let permissions: AgentPermission[] = agent.permissions || [];
            
            if (!agentSnap.empty) {
                const data = agentSnap.docs[0].data();
                password = data.password || '';
                isNew = data.isNew !== false;
                if (data.permissions) {
                    permissions = data.permissions;
                }
            } else {
                password = agent.internalPassword || 'Dgi2026!';
                isNew = agent.isNew !== false;
            }

            setEditingAgent({
                ...agent,
                permissions,
                internalPassword: password,
                isNew: isNew
            });
            setEditAgentPassword(password);
            setEditAgentIsNew(isNew);
        } catch (e) {
            console.error("Error opening edit agent info:", e);
            setEditingAgent({
                ...agent,
                permissions: agent.permissions || [],
                internalPassword: agent.internalPassword || 'Dgi2026!',
                isNew: agent.isNew !== false
            });
            setEditAgentPassword(agent.internalPassword || 'Dgi2026!');
            setEditAgentIsNew(agent.isNew !== false);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (attributingAgent && user) {
            const isSuper = (user as any).isSuperContribuable;
            const q = (user.role === 'admin' || isSuper)
                ? query(collection(db, 'users'), where('role', '==', 'contributor'))
                : query(
                    collection(db, 'users'), 
                    and(
                        where('role', '==', 'contributor'),
                        or(where('assignedAgentId', '==', null), where('assignedAgentId', '==', user.uid))
                    )
                );

            return onSnapshot(q, (snap) => {
                setAllTaxpayers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser)));
            });
        }
    }, [attributingAgent, user]);

    const handleAttribute = async (taxpayer: AppUser) => {
        if (!attributingAgent) return;
        try {
            await updateDoc(doc(db, 'users', taxpayer.uid), {
                assignedAgentId: attributingAgent.uid,
                assignedAgentName: attributingAgent.displayName,
                assignedAgentEmail: attributingAgent.email,
                updatedAt: serverTimestamp()
            });

            // Retroactively assign existing conversations to the agent too
            const convsSnap = await getDocs(query(
                collection(db, 'conversations'), 
                where('contributorId', '==', taxpayer.uid)
            ));
            for (const convDoc of convsSnap.docs) {
                await updateDoc(convDoc.ref, {
                    agentId: attributingAgent.uid,
                    assignedAgentId: attributingAgent.uid,
                    assignedAgentEmail: attributingAgent.email,
                    assignedAgentName: attributingAgent.displayName
                });
            }

            setStatus(`${taxpayer.companyName} attribué à ${attributingAgent.displayName}`);
        } catch (e) {
            console.error(e);
        }
    };

    const handleUpdateAgentRole = async () => {
        if (!editingAgent) return;
        setLoading(true);
        setStatus("Mise à jour en cours...");
        try {
            const isPasswordChanged = editAgentPassword !== editingAgent.internalPassword;
            const finalIsNew = isPasswordChanged ? true : editAgentIsNew;

            const userDocRef = doc(db, 'users', editingAgent.uid);
            await updateDoc(userDocRef, {
                role: editingAgent.role,
                permissions: editingAgent.permissions || [],
                internalPassword: editAgentPassword,
                isNew: finalIsNew,
                isActive: editingAgent.isActive !== false
            });

            const agentsRef = collection(db, 'agents');
            const agentSnap = await getDocs(query(agentsRef, where('email', '==', editingAgent.email.toLowerCase().trim())));
            
            if (!agentSnap.empty) {
                const matchedAgentDocRef = agentSnap.docs[0].ref;
                await updateDoc(matchedAgentDocRef, {
                    role: editingAgent.role,
                    permissions: editingAgent.permissions || [],
                    password: editAgentPassword,
                    isNew: finalIsNew,
                    displayName: editingAgent.displayName
                });
            } else {
                await setDoc(doc(db, 'agents', editingAgent.uid), {
                    email: editingAgent.email.toLowerCase().trim(),
                    role: editingAgent.role,
                    displayName: editingAgent.displayName,
                    uid: editingAgent.uid,
                    password: editAgentPassword,
                    isNew: finalIsNew,
                    permissions: editingAgent.permissions || []
                });
            }

            setEditingAgent(null);
            setStatus("Profil Agent mis à jour avec succès dans l'infrastructure de la DGI !");
        } catch (e) {
            console.error(e);
            setStatus("Erreur lors de la mise à jour");
        } finally {
            setLoading(false);
            setTimeout(() => setStatus(''), 4000);
        }
    };

    const toggleAgentStatus = async (agent: AppUser) => {
        await updateDoc(doc(db, 'users', agent.uid), {
            isActive: !agent.isActive
        });
    };

    const deleteAgent = async (agentId: string) => {
        if (confirm('Supprimer définitivement cet agent ?')) {
            await deleteDoc(doc(db, 'users', agentId));
            await deleteDoc(doc(db, 'agents', agentId));
        }
    };

    const resetAgentPassword = async (agent: AppUser) => {
        const newTempPass = 'Dgi' + Math.random().toString(36).slice(-4).toUpperCase() + '!';
        await updateDoc(doc(db, 'users', agent.uid), {
            internalPassword: newTempPass,
            isNew: true
        });
        await updateDoc(doc(db, 'agents', agent.uid), {
            password: newTempPass,
            isNew: true
        });
        setStatus(`Mot de passe réinitialisé pour ${agent.displayName}. Nouveau code temporaire: ${newTempPass}`);
    };

    const resetVisuals = async () => {
        if (confirm('Voulez-vous rétablir les visuels par défaut de la DGI ?')) {
            await updateTheme(DEFAULT_THEME);
            setStatus('Paramètres visuels réinitialisés !');
        }
    };

    const handleDGIExchangeSimu = () => {
        // Disabled for Branding Unification
        setStatus("Mode Unifié Activé");
    };

    return (
        <div className="p-4 md:p-8 lg:p-10 max-w-5xl mx-auto font-sans bg-[#F4F7F6] lg:bg-transparent min-h-screen">
            <header className="mb-6 md:mb-12 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="text-center sm:text-left">
                    <h1 className="text-xl md:text-3xl lg:text-4xl font-black text-[#2C3E50] tracking-tight italic uppercase">Configuration</h1>
                    <p className="text-[7px] md:text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1 opacity-60">Gestion de l'Identité & Staff</p>
                </div>
                {status && (
                    <div className="mx-auto sm:mx-0 px-3 py-1.5 md:px-4 md:py-2 bg-primary/10 text-primary text-[8px] md:text-[10px] font-black rounded-xl border border-primary/20 animate-in fade-in slide-in-from-top duration-300">
                        {status}
                    </div>
                )}
            </header>

            <div className="space-y-8 md:space-y-12">
                {/* Visual Settings for Super Admin */}
                {hasPermission(user, 'branding') && (
                    <section className="bg-white p-6 md:p-10 rounded-[2rem] md:rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4">
                             <button 
                                onClick={resetVisuals}
                                className="px-4 py-2 bg-gray-50 text-gray-400 text-[8px] font-black uppercase tracking-widest rounded-lg hover:text-red-500 transition-colors"
                             >
                                <RefreshCw size={10} className="inline mr-2" /> Réinitialiser
                             </button>
                        </div>
                        <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-10">
                            <div className="p-2 md:p-3 bg-primary/10 text-primary rounded-xl md:rounded-2xl shadow-inner">
                                <Settings size={18} className="md:w-6 md:h-6" />
                            </div>
                            <h2 className="text-lg md:text-2xl font-black text-[#2C3E50]">Branding & Interface</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Police du Système</label>
                                    <select 
                                        className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs outline-none focus:ring-4 focus:ring-primary/5 transition-all"
                                        value={theme.font}
                                        onChange={e => updateTheme({ font: e.target.value })}
                                    >
                                        <option value="Inter, sans-serif">Inter (Standard Modern)</option>
                                        <option value="'Space Grotesk', sans-serif">Space Grotesk (Technical)</option>
                                        <option value="'Outfit', sans-serif">Outfit (Diplomatique)</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Nom de l'Application</label>
                                    <input 
                                        className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-inner"
                                        value={theme.appName}
                                        onChange={e => updateTheme({ appName: e.target.value })}
                                        placeholder="Ex: Portail DGI"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Titre de l'Onglet Navigateur</label>
                                    <input 
                                        className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-inner"
                                        value={theme.appTitle}
                                        onChange={e => updateTheme({ appTitle: e.target.value })}
                                        placeholder="Ex: Direction Générale des Impôts"
                                    />
                                </div>
                                <div className="pt-4">
                                    <button 
                                        onClick={() => {
                                            setDoc(doc(db, 'settings', 'branding'), theme, { merge: true });
                                            setStatus("Branding institutionnel sauvegardé avec succès !");
                                        }}
                                        className="w-full py-4 bg-primary text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-3"
                                    >
                                        <ShieldCheck size={16} />
                                        Enregistrer les paramètres de branding
                                    </button>
                                </div>
                                <div className="space-y-6 pt-4">
                                    <div className="flex items-center justify-between">
                                         <div className="space-y-2 flex-1">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Identité Visuelle (Logo)</label>
                                            <div className="flex gap-4">
                                                <div className="w-16 h-16 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-center overflow-hidden relative shadow-inner">
                                                    <img src={theme.logoUrl} className="w-full h-full object-contain p-2" alt="Logo" referrerPolicy="no-referrer" />
                                                </div>
                                                <label className="flex-1 flex flex-col justify-center gap-1 cursor-pointer group">
                                                    <div className="text-xs font-black uppercase text-primary tracking-widest flex items-center gap-2 group-hover:scale-105 transition-transform">
                                                        <Upload size={14} /> Charger Logo
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 italic">Mise à jour instantanée (Max 2Mo)</p>
                                                    <input 
                                                        type="file" 
                                                        className="hidden" 
                                                        accept="image/*" 
                                                        onChange={e => {
                                                            handleFileUpload(e, 'logo');
                                                            e.target.value = '';
                                                        }} 
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="pt-8 border-t border-gray-50 flex flex-col md:flex-row items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 text-orange-600">
                                        <Info size={16} />
                                        <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">Le bouton d'enregistrement fixera l'identité visuelle de manière permanente.</p>
                                    </div>
                                    <button 
                                        onClick={() => {
                                            updateTheme(theme);
                                            setStatus('Identité visuelle sauvegardée avec succès !');
                                        }}
                                        className="px-10 py-5 bg-[#2C3E50] text-white rounded-[1.5rem] font-black text-[10px] uppercase tracking-[0.3em] shadow-2xl shadow-gray-200 hover:brightness-110 active:scale-95 transition-all"
                                    >
                                        Sauvegarder l'Identité
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Message de Bienvenue (Tableau de Bord)</label>
                                    <textarea 
                                        className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl font-bold text-xs outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-inner min-h-[100px] resize-none"
                                        value={theme.welcomeMessage}
                                        onChange={e => updateTheme({ welcomeMessage: e.target.value })}
                                        placeholder="Message affiché aux contribuables..."
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Support Email</label>
                                    <input 
                                        className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-inner"
                                        value={theme.supportEmail}
                                        onChange={e => updateTheme({ supportEmail: e.target.value })}
                                        placeholder="Ex: support@dgi.gouv"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Texte de Pied de Page (Copyright)</label>
                                    <input 
                                        className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl font-black text-xs outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-inner"
                                        value={theme.footerText}
                                        onChange={e => updateTheme({ footerText: e.target.value })}
                                        placeholder="Ex: © 2026 Direction Générale des Impôts"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Arrondi des Bordures ({theme.borderRadius}px)</label>
                                    <input 
                                        type="range" min="0" max="40" step="1"
                                        className="w-full accent-primary"
                                        value={theme.borderRadius}
                                        onChange={e => updateTheme({ borderRadius: parseInt(e.target.value) })}
                                    />
                                </div>
                            </div>
                            
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Couleur Signature</label>
                                    <div className="flex items-center gap-4">
                                        <input 
                                            type="color" 
                                            className="w-14 h-14 rounded-2xl overflow-hidden border-4 border-gray-100 bg-white cursor-pointer shadow-sm"
                                            value={theme.primary}
                                            onChange={e => updateTheme({ primary: e.target.value })}
                                        />
                                        <div>
                                            <p className="text-xs font-black text-[#2C3E50]">{theme.primary.toUpperCase()}</p>
                                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Teinte Principale</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Icône Navigateur (Favicon)</label>
                                    <div className="flex gap-4">
                                        <div className="w-16 h-16 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-center overflow-hidden p-3 relative shadow-inner">
                                            <img src={theme.faviconUrl} className="w-full h-full object-contain" alt="Fav" referrerPolicy="no-referrer" />
                                        </div>
                                        <label className="flex-1 flex flex-col justify-center gap-1 cursor-pointer group">
                                            <div className="text-xs font-black uppercase text-primary tracking-widest flex items-center gap-2 group-hover:scale-105 transition-transform">
                                                <Upload size={14} /> Charger Favicon
                                            </div>
                                            <p className="text-[10px] text-gray-400 italic">Mise à jour instantanée (Max 1Mo)</p>
                                            <input 
                                                type="file" 
                                                className="hidden" 
                                                accept="image/*" 
                                                onChange={e => {
                                                    handleFileUpload(e, 'favicon');
                                                    e.target.value = '';
                                                }} 
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Ombrage</label>
                                        <select 
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl font-black text-[10px] outline-none"
                                            value={theme.cardShadow}
                                            onChange={e => updateTheme({ cardShadow: e.target.value as any })}
                                        >
                                            <option value="none">Aucun</option>
                                            <option value="sm">Léger</option>
                                            <option value="md">Moyen</option>
                                            <option value="lg">Prononcé</option>
                                            <option value="xl">Expert</option>
                                            <option value="2xl">Maximal</option>
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Densité UI</label>
                                        <select 
                                            className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl font-black text-[10px] outline-none"
                                            value={theme.componentPadding}
                                            onChange={e => updateTheme({ componentPadding: e.target.value as any })}
                                        >
                                            <option value="compact">Compacte</option>
                                            <option value="normal">Standard</option>
                                            <option value="relaxed">Aérée</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {/* Simulation DGI Échange Section - Reserved for Master Admin */}
                {user?.email === 'sibinimigjc@gmail.com' && (
                    <section className="bg-[#0F172A] p-8 md:p-12 rounded-[2.5rem] md:rounded-[3rem] border border-blue-500/30 shadow-2xl shadow-blue-900/40 relative overflow-hidden group animate-in zoom-in duration-700">
                        {/* Background Accents */}
                        <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl group-hover:bg-blue-600/20 transition-all duration-1000"></div>
                        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-slate-800/20 rounded-full blur-3xl group-hover:bg-blue-900/10 transition-all duration-1000"></div>
                        
                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-20 transition-all duration-500 scale-150">
                            <Building2 size={120} className="text-blue-400 transform rotate-6" />
                        </div>
                        
                        <div className="flex flex-col md:flex-row items-start md:items-center gap-6 mb-10 relative z-10">
                            <div className="p-4 bg-gradient-to-br from-[#2980B9] to-[#1E3A8A] text-white rounded-[1.5rem] shadow-[0_0_30px_rgba(41,128,185,0.4)] border border-white/20 animate-pulse">
                                <ArrowRightLeft size={28} className="md:w-8 md:h-8" />
                            </div>
                            <div>
                                <div className="flex items-center gap-3">
                                    <h2 className="text-xl md:text-3xl font-black text-white tracking-tight">Laboratoire DGI Exchange</h2>
                                    <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-[8px] font-black uppercase tracking-[0.2em] rounded-full border border-blue-500/20">Alpha v1.2</span>
                                </div>
                                <p className="text-[10px] md:text-xs text-[#2980B9] font-black uppercase tracking-[0.3em] mt-1 opacity-90">Simulation d'Unification Fiscale</p>
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
                            <div className="lg:col-span-7 space-y-4">
                                <p className="text-gray-400 text-xs md:text-sm font-medium leading-relaxed">
                                    Basculez instantanément vers l'environnement métier <span className="text-white font-black underline decoration-blue-500 decoration-2 underline-offset-4">DGI ÉCHANGE</span>. 
                                    Cette simulation force le branding institutionnel (Bleu Navy, Armoiries RDC) et l'unification des paramètres pour valider l'expérience utilisateur finale.
                                </p>
                                <div className="flex flex-wrap gap-4">
                                    <div className="flex items-center gap-2 text-blue-400/60 text-[10px] font-bold uppercase">
                                        <Shield size={14} /> Auto-Login Admin
                                    </div>
                                    <div className="flex items-center gap-2 text-blue-400/60 text-[10px] font-bold uppercase">
                                        <Layout size={14} /> Branding Forcé
                                    </div>
                                    <div className="flex items-center gap-2 text-blue-400/60 text-[10px] font-bold uppercase">
                                        <History size={14} /> Persistance Session
                                    </div>
                                </div>
                            </div>
                            <div className="lg:col-span-5 w-full">
                                <button 
                                    onClick={handleDGIExchangeSimu}
                                    className="w-full px-10 py-6 bg-white text-[#0F172A] rounded-[1.8rem] font-black text-xs md:text-sm uppercase tracking-[0.25em] shadow-[0_20px_50px_rgba(255,255,255,0.1)] hover:shadow-[0_20px_60px_rgba(59,130,246,0.3)] hover:-translate-y-1 active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-blue-50 group/btn"
                                >
                                    <ExternalLink size={20} className="group-hover:btn:rotate-12 transition-transform" />
                                    Déployer DGI ÉCHANGE
                                </button>
                                <p className="text-center mt-4 text-[9px] text-gray-500 font-bold uppercase tracking-widest opacity-50">Redirection vers l'instance sécurisée</p>
                            </div>
                        </div>
                        
                        {/* Status bar */}
                        <div className="mt-10 pt-6 border-t border-white/5 flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-ping"></div>
                            <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">Serveur de simulation : Opérationnel</span>
                        </div>
                    </section>
                )}

                {/* Agent Management Section for Admin */}
                {hasPermission(user, 'agent_management') && (
                    <section className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5">
                        <div className="flex items-center justify-between mb-10">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-green-50 text-green-600 rounded-2xl shadow-inner">
                                    <ShieldCheck size={24} />
                                </div>
                                <h2 className="text-2xl font-black text-[#2C3E50]">Gestion des Agents DGI</h2>
                            </div>
                            <span className="text-[10px] font-black bg-gray-100 text-gray-500 px-4 py-1.5 rounded-full uppercase tracking-widest">{agents.length} Agents</span>
                        </div>

                        <div className="space-y-10">
                            <div className="flex flex-col gap-8 p-8 bg-gray-50 rounded-[2rem] border border-gray-100 shadow-inner">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Prénom</label>
                                        <input 
                                            placeholder="Ex: Jean"
                                            className="w-full px-6 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-black outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm"
                                            value={agentForm.firstName}
                                            onChange={e => setAgentForm(p => ({ ...p, firstName: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Nom (Patronyme)</label>
                                        <input 
                                            placeholder="Ex: MUKENDI"
                                            className="w-full px-6 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-black outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm"
                                            value={agentForm.lastName}
                                            onChange={e => setAgentForm(p => ({ ...p, lastName: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Email Google Professionnel</label>
                                        <input 
                                            placeholder="agent.nom@dgi.gouv.cd" 
                                            className="w-full px-6 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-black outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm"
                                            value={agentForm.email}
                                            onChange={e => setAgentForm(p => ({ ...p, email: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Téléphone de Service</label>
                                        <input 
                                            placeholder="+243..." 
                                            className="w-full px-6 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-black outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm"
                                            value={agentForm.phone}
                                            onChange={e => setAgentForm(p => ({ ...p, phone: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Mot de Passe de Départ (Clé Initiale)</label>
                                        <input 
                                            placeholder="Ex: Dgi2026!" 
                                            className="w-full px-6 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-black outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm text-amber-700 bg-amber-50/20"
                                            value={agentForm.tempPassword}
                                            onChange={e => setAgentForm(p => ({ ...p, tempPassword: e.target.value }))}
                                        />
                                    </div>
                                    <div className="space-y-2 lg:col-span-1">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Périmètre de Responsabilité</label>
                                        <div className="flex gap-4">
                                            <button 
                                                onClick={() => setAgentForm(p => ({ ...p, role: 'agent' }))}
                                                className={cn("flex-1 py-4 rounded-xl border-2 font-black text-[10px] uppercase tracking-widest transition-all", agentForm.role === 'agent' ? "bg-primary text-white border-primary" : "bg-white text-gray-400 border-gray-100")}
                                            >
                                                Gestionnaire Dossiers
                                            </button>
                                            <button 
                                                onClick={() => setAgentForm(p => ({ ...p, role: 'admin' }))}
                                                className={cn("flex-1 py-4 rounded-xl border-2 font-black text-[10px] uppercase tracking-widest transition-all", agentForm.role === 'admin' ? "bg-primary text-white border-primary" : "bg-white text-gray-400 border-gray-100")}
                                            >
                                                Superviseur Admin
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Droits d'accès granulaires</label>
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        {[
                                            { id: 'branding', label: 'Branding', icon: Settings },
                                            { id: 'agent_management', label: 'Gestion Agents', icon: Users },
                                            { id: 'deletion', label: 'Suppression', icon: Trash2 },
                                            { id: 'tax_consultation', label: 'Consultation NIU', icon: ShieldCheck }
                                        ].map(p => (
                                            <button 
                                                key={p.id}
                                                onClick={() => {
                                                    const perm = p.id as AgentPermission;
                                                    setAgentForm(prev => ({
                                                        ...prev,
                                                        permissions: prev.permissions.includes(perm) 
                                                            ? prev.permissions.filter(x => x !== perm) 
                                                            : [...prev.permissions, perm]
                                                    }));
                                                }}
                                                className={cn(
                                                    "p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all",
                                                    agentForm.permissions.includes(p.id as AgentPermission) ? "bg-primary/5 border-primary text-primary" : "bg-white border-gray-100 text-gray-400 hover:border-gray-200"
                                                )}
                                            >
                                                <p.icon size={20} />
                                                <span className="text-[8px] font-black uppercase tracking-widest">{p.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-end justify-center pt-4">
                                    <button 
                                        onClick={handleCreateAgent}
                                        disabled={loading}
                                        className="w-full md:w-auto px-16 py-5 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                    >
                                        <UserPlus size={18} />
                                        <span>{loading ? "Calcul en cours..." : "Sceller & Créer la Fiche Agent"}</span>
                                    </button>
                                </div>
                            </div>
                            
                            <div className="overflow-hidden bg-white rounded-[2rem] border border-gray-100 shadow-sm">
                                {agents.length === 0 ? (
                                    <div className="text-center py-20 opacity-20 border-2 border-dashed border-gray-100 rounded-[2rem] m-6">
                                        <UserX size={64} className="mx-auto mb-4" />
                                        <p className="text-xs font-black uppercase tracking-widest">Aucun agent enregistré</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-gray-50">
                                        {/* Table Header */}
                                        <div className="grid grid-cols-12 gap-4 px-8 py-4 bg-gray-50/50 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            <div className="col-span-5">Agent & Email</div>
                                            <div className="col-span-3 text-center">Rôle DGI</div>
                                            <div className="col-span-1 text-center">Statut</div>
                                            <div className="col-span-3 text-right">Actions</div>
                                        </div>
                                        
                                        {agents.map(agent => (
                                            <div 
                                                key={agent.uid} 
                                                className={cn(
                                                    "grid grid-cols-12 gap-4 px-8 py-5 items-center hover:bg-gray-50/80 transition-all group",
                                                    !agent.isActive && "opacity-50"
                                                )}
                                            >
                                                <div 
                                                    onClick={() => openEditAgent(agent)}
                                                    className="col-span-5 flex items-center gap-4 cursor-pointer hover:opacity-80 group/row transition-all"
                                                    title="Modifier les habilitations de l'agent"
                                                >
                                                    <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary flex items-center justify-center font-black uppercase shadow-sm border border-primary/10 group-hover/row:scale-110 transition-transform">
                                                        {agent.displayName[0]}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-black text-[#2C3E50] truncate group-hover/row:text-primary transition-colors">{agent.displayName}</p>
                                                        <p className="text-[10px] text-gray-400 font-medium truncate italic">{agent.email}</p>
                                                    </div>
                                                </div>
                                                
                                                <div className="col-span-3 flex justify-center">
                                                    <span className={cn(
                                                        "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border",
                                                        agent.role === 'admin' ? "bg-primary text-white border-primary shadow-sm" : "bg-blue-50 text-blue-600 border-blue-100"
                                                    )}>
                                                        {agent.role === 'admin' ? 'Superviseur' : 'Gestionnaire'}
                                                    </span>
                                                </div>
                                                
                                                <div className="col-span-1 flex justify-center">
                                                    <div className={cn("w-2 h-2 rounded-full", agent.isActive ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-gray-300")} title={agent.isActive ? 'Actif' : 'Désactivé'} />
                                                </div>

                                                <div className="col-span-3 flex justify-end gap-2">
                                                    <button 
                                                        onClick={() => setViewingAgentProfile(agent)}
                                                        className="px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-primary hover:text-white hover:border-primary transition-all shadow-sm"
                                                    >
                                                        Gérer le profil
                                                    </button>
                                                    <button 
                                                        onClick={() => openEditAgent(agent)}
                                                        className="px-4 py-2 bg-primary/10 border border-primary/20 text-primary rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-primary hover:text-white hover:border-primary transition-all shadow-sm flex items-center gap-1"
                                                        title="Paramètres d'accès & Habilitations"
                                                    >
                                                        <Settings size={12} />
                                                        <span>Modifier</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                <section className="bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-2xl shadow-gray-500/5">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shadow-inner">
                            <UserCircle size={24} />
                        </div>
                        <h2 className="text-2xl font-black text-[#2C3E50]">Votre Authentification</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="p-8 bg-gray-50/50 rounded-3xl border border-gray-100">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Identité Digitale</p>
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-inner bg-white flex items-center justify-center text-primary text-xl font-black">
                                    {user?.displayName[0]}
                                </div>
                                <div>
                                    <p className="text-base font-black text-[#2C3E50]">{user?.displayName}</p>
                                    <p className="text-xs text-gray-400 font-medium">{user?.email}</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-8 bg-gray-50/50 rounded-3xl border border-gray-100 flex flex-col justify-center">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Statut & Habilitation</p>
                            <div className="flex gap-2">
                                <span className={cn(
                                    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] border",
                                    user?.role === 'admin' ? "bg-primary text-white border-primary" : "bg-blue-600 text-white border-blue-600"
                                )}>
                                    {user?.role === 'admin' ? 'ADMINISTRATEUR GLOBAL' : 'AGENT DGI CERTIFIÉ'}
                                </span>
                                <span className="px-4 py-1.5 bg-green-500 text-white rounded-full text-[10px] font-black uppercase tracking-[0.1em] shadow-lg shadow-green-500/20">
                                    ACTIF
                                </span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Edit Agent Modal */}
                {editingAgent && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
                        <div className="bg-white p-8 md:p-10 rounded-[3.5rem] shadow-2xl max-w-xl w-full border border-white animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto custom-scrollbar relative">
                            <button 
                                onClick={() => setEditingAgent(null)}
                                className="absolute top-6 right-6 p-2 bg-gray-50 rounded-xl hover:text-red-500 transition-colors"
                            >
                                <X size={20} />
                            </button>
                            <div className="w-16 h-16 bg-primary/10 text-primary rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-inner">
                                <Settings size={40} />
                            </div>
                            <h2 className="text-2xl font-black text-[#2C3E50] text-[#2C3E50] text-center mb-1 italic uppercase tracking-tight">Habilitation & Droits</h2>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest text-center mb-10">{editingAgent.email}</p>

                            <div className="space-y-6">
                                {/* Périmètre de responsabilité */}
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Périmètre de Responsabilité</label>
                                    <div className="flex gap-4">
                                        <button 
                                            type="button"
                                            onClick={() => setEditingAgent(p => p ? { ...p, role: 'agent' } : null)}
                                            className={cn(
                                                "flex-1 py-4 rounded-xl border-2 font-black text-[10px] uppercase tracking-widest transition-all", 
                                                editingAgent.role === 'agent' 
                                                    ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
                                                    : "bg-white text-gray-400 border-gray-100 hover:border-gray-200"
                                            )}
                                        >
                                            Gestionnaire Dossiers
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => setEditingAgent(p => p ? { ...p, role: 'admin' } : null)}
                                            className={cn(
                                                "flex-1 py-4 rounded-xl border-2 font-black text-[10px] uppercase tracking-widest transition-all", 
                                                editingAgent.role === 'admin' 
                                                    ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" 
                                                    : "bg-white text-gray-400 border-gray-100 hover:border-gray-200"
                                            )}
                                        >
                                            Superviseur Admin
                                        </button>
                                    </div>
                                </div>

                                {/* Droits d'accès granulaires */}
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Droits d'accès granulaires (Permissions)</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { id: 'branding', label: 'Branding', icon: Settings },
                                            { id: 'agent_management', label: 'Gestion Agents', icon: Users },
                                            { id: 'deletion', label: 'Suppression', icon: Trash2 },
                                            { id: 'tax_consultation', label: 'Consultation NIU', icon: ShieldCheck }
                                        ].map(p => {
                                            const hasPerm = editingAgent.permissions?.includes(p.id as AgentPermission);
                                            return (
                                                <button 
                                                    type="button"
                                                    key={p.id}
                                                    onClick={() => {
                                                        const perm = p.id as AgentPermission;
                                                        const currentPerms = editingAgent.permissions || [];
                                                        setEditingAgent(prev => {
                                                            if (!prev) return null;
                                                            return {
                                                                ...prev,
                                                                permissions: currentPerms.includes(perm)
                                                                    ? currentPerms.filter(x => x !== perm)
                                                                    : [...currentPerms, perm]
                                                            };
                                                        });
                                                    }}
                                                    className={cn(
                                                        "p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all",
                                                        hasPerm ? "bg-primary/5 border-primary text-primary" : "bg-white border-gray-100 text-gray-400 hover:border-gray-200"
                                                    )}
                                                >
                                                    <p.icon size={18} />
                                                    <span className="text-[8px] font-black uppercase tracking-widest">{p.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Mot de Passe de l'Agent */}
                                <div className="space-y-2 p-5 bg-amber-50/20 border border-amber-100 rounded-3xl">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black text-amber-800 uppercase tracking-widest">Mot de Passe Interne / Départ</label>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const generated = 'Dgi' + Math.random().toString(36).slice(-4).toUpperCase() + '!';
                                                setEditAgentPassword(generated);
                                                setEditAgentIsNew(true);
                                            }}
                                            className="text-[9px] font-black uppercase tracking-widest text-primary hover:underline hover:text-primary/80 transition-all"
                                        >
                                            Générer un code
                                        </button>
                                    </div>
                                    <input 
                                        type="text"
                                        placeholder="Mot de passe" 
                                        className="w-full px-6 py-4 bg-white border border-gray-200 rounded-2xl text-sm font-black outline-none focus:ring-4 focus:ring-primary/5 transition-all shadow-sm text-center tracking-wider text-amber-700 font-mono"
                                        value={editAgentPassword}
                                        onChange={e => {
                                            setEditAgentPassword(e.target.value);
                                            setEditAgentIsNew(true);
                                        }}
                                    />
                                    <div className="flex items-center gap-2 pt-2">
                                        <input 
                                            type="checkbox"
                                            id="force-password-change"
                                            checked={editAgentIsNew}
                                            onChange={e => setEditAgentIsNew(e.target.checked)}
                                            className="rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        <label htmlFor="force-password-change" className="text-[9px] font-bold text-gray-400 uppercase tracking-wide cursor-pointer user-select-none">
                                            Forcer le changement de MDP à la prochaine connexion
                                        </label>
                                    </div>
                                </div>
                                <div className="flex gap-4">
                                     <button 
                                        onClick={() => setEditingAgent(null)}
                                        className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                                    >
                                        Annuler
                                    </button>
                                    <button 
                                        disabled={loading}
                                        onClick={handleUpdateAgentRole}
                                        className="flex-1 py-4 bg-primary text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20"
                                    >
                                        Appliquer
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Agent Detail Side Panel */}
                {viewingAgentProfile && (
                    <div className="fixed inset-0 z-[120] flex justify-end bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-300">
                        <motion.div 
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            className="w-full max-w-lg bg-white h-screen shadow-2xl relative flex flex-col p-8 overflow-y-auto"
                        >
                            <button 
                                onClick={() => setViewingAgentProfile(null)}
                                className="absolute top-6 left-6 p-2 bg-gray-50 rounded-xl hover:text-red-500 transition-colors"
                            >
                                <X size={20} />
                            </button>

                            <div className="mt-12 mb-10 text-center">
                                <div className="w-24 h-24 bg-primary/5 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-6 text-3xl font-black border border-primary/10 shadow-inner">
                                    {viewingAgentProfile.displayName[0]}
                                </div>
                                <h3 className="text-2xl font-black text-[#2C3E50] tracking-tighter uppercase italic">{viewingAgentProfile.displayName}</h3>
                                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1 opacity-60">{viewingAgentProfile.email}</p>
                            </div>

                            <div className="space-y-8">
                                <section className="space-y-4">
                                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] border-b border-primary/10 pb-2">Informations de Contact</p>
                                    <div className="grid grid-cols-1 gap-4">
                                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-4">
                                            <Phone size={18} className="text-gray-400" />
                                            <div>
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Téléphone</p>
                                                <input 
                                                    className="bg-transparent font-bold text-sm outline-none w-full"
                                                    value={viewingAgentProfile.phone || ''}
                                                    onChange={e => setViewingAgentProfile({...viewingAgentProfile, phone: e.target.value})}
                                                    placeholder="Non renseigné"
                                                />
                                            </div>
                                        </div>
                                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center gap-4">
                                            <MapPin size={18} className="text-gray-400" />
                                            <div>
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Adresse Physique</p>
                                                <input 
                                                    className="bg-transparent font-bold text-sm outline-none w-full"
                                                    value={viewingAgentProfile.address || ''}
                                                    onChange={e => setViewingAgentProfile({...viewingAgentProfile, address: e.target.value})}
                                                    placeholder="Non renseigné"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className="space-y-4">
                                    <p className="text-[10px] font-black text-primary uppercase tracking-[0.2em] border-b border-primary/10 pb-2">Contribuables Assignés</p>
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-bold text-gray-400 uppercase">Gestion du Portefeuille</p>
                                        <button 
                                            onClick={() => {
                                                setAttributingAgent(viewingAgentProfile);
                                                setViewingAgentProfile(null);
                                            }}
                                            className="px-3 py-1 bg-primary text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:brightness-110"
                                        >
                                            Attribuer nouveau
                                        </button>
                                    </div>
                                    
                                    <div className="space-y-2">
                                        {allTaxpayers.filter(t => t.assignedAgentId === viewingAgentProfile.uid).length === 0 ? (
                                            <p className="text-center py-6 text-[10px] font-bold text-gray-300 uppercase tracking-tighter border-2 border-dashed border-gray-50 rounded-2xl">Aucun contribuable assigné</p>
                                        ) : (
                                            allTaxpayers.filter(t => t.assignedAgentId === viewingAgentProfile.uid).map(t => (
                                                <div key={t.uid} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-[10px] font-black uppercase text-primary">
                                                            {t.companyName?.[0]}
                                                        </div>
                                                        <span className="text-xs font-black text-[#2C3E50]">{t.companyName}</span>
                                                    </div>
                                                    <button 
                                                        onClick={async () => {
                                                            await updateDoc(doc(db, 'users', t.uid), { assignedAgentId: null, assignedAgentName: null });
                                                        }}
                                                        className="text-gray-300 hover:text-red-500 transition-colors"
                                                    >
                                                        <UserMinus size={14} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </section>

                                <div className="pt-10 flex gap-4">
                                     <button 
                                        onClick={() => {
                                            if (confirm('Voulez-vous enregistrer les modifications apportées aux coordonnées ?')) {
                                                updateDoc(doc(db, 'users', viewingAgentProfile.uid), {
                                                   phone: viewingAgentProfile.phone || null,
                                                   address: viewingAgentProfile.address || null
                                                });
                                                setViewingAgentProfile(null);
                                            } else {
                                                setViewingAgentProfile(null);
                                            }
                                        }}
                                        className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20"
                                    >
                                        Sauvegarder & Fermer
                                    </button>
                                    <button 
                                        onClick={() => deleteAgent(viewingAgentProfile.uid).then(() => setViewingAgentProfile(null))}
                                        className="px-6 py-4 bg-red-50 text-red-500 rounded-2xl font-black text-[10px] uppercase tracking-widest border border-red-100 hover:bg-red-100"
                                    >
                                        Supprimer
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* Attribution Modal */}
                {attributingAgent && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
                        <div className="bg-white p-8 md:p-12 rounded-[3.5rem] shadow-2xl max-w-2xl w-full border border-white animate-in zoom-in duration-300 max-h-[90vh] flex flex-col">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h2 className="text-2xl font-black text-[#2C3E50]">Attribution Dossiers</h2>
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Cibles pour {attributingAgent.displayName}</p>
                                </div>
                                <button onClick={() => setAttributingAgent(null)} className="p-3 bg-gray-50 text-gray-400 rounded-2xl hover:text-red-500 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <input 
                                placeholder="Rechercher un contribuable (Dénomination, NIU...)"
                                className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-bold outline-none focus:ring-4 focus:ring-primary/5 transition-all mb-6"
                                value={taxpayerSearch}
                                onChange={e => setTaxpayerSearch(e.target.value)}
                            />

                            <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                                {allTaxpayers
                                    .filter(t => t.companyName?.toLowerCase().includes(taxpayerSearch.toLowerCase()) || t.niu?.includes(taxpayerSearch))
                                    .map(t => (
                                        <div key={t.uid} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-primary/30 transition-all">
                                            <div className="flex items-center gap-4">
                                                {t.logoUrl ? (
                                                    <img src={t.logoUrl} className="w-10 h-10 rounded-xl object-contain bg-white p-1" referrerPolicy="no-referrer" />
                                                ) : (
                                                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-black text-xs text-gray-400">
                                                        {t.companyName?.[0]}
                                                    </div>
                                                )}
                                                <div>
                                                    <p className="text-xs font-black text-[#2C3E50]">{t.companyName}</p>
                                                    <p className="text-[9px] text-gray-400 font-bold tracking-tight">NIU: {t.niu} • {t.assignedAgentId === attributingAgent.uid ? "Déjà assigné" : t.assignedAgentName ? `Assigné à ${t.assignedAgentName}` : "Non assigné"}</p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => handleAttribute(t)}
                                                disabled={t.assignedAgentId === attributingAgent.uid}
                                                className={cn(
                                                    "px-6 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all",
                                                    t.assignedAgentId === attributingAgent.uid ? "bg-green-100 text-green-600 cursor-default" : "bg-primary text-white shadow-lg shadow-primary/20 hover:scale-105 active:scale-95"
                                                )}
                                            >
                                                {t.assignedAgentId === attributingAgent.uid ? "Confirmé" : "Assigner"}
                                            </button>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const LoginPage = () => {
    const { loginWithGoogle, authActionLoading } = useAuth();
    const { theme } = useTheme();
    const [view, setView] = useState<'login' | 'register'>('login');
    const [loginTab, setLoginTab] = useState<'agent' | 'taxpayer'>('agent');
    
    // Taxpayer Registration Form States - Zero Password, Google Only
    const [regData, setRegData] = useState({ nif: '', name: '' });
    const [regLoading, setRegLoading] = useState(false);
    const [regError, setRegError] = useState('');

    const handleTaxpayerGoogleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!regData.nif.trim()) {
            setRegError('Le Numéro d’Impôt (NIF) est requis.');
            return;
        }
        if (!regData.name.trim()) {
            setRegError('La Raison Sociale / Nom professionnel est requis.');
            return;
        }
        setRegLoading(true);
        setRegError('');
        try {
            // Store taxpayer registration details in localStorage so onAuthStateChanged can pick it up
            localStorage.setItem('pending_taxpayer_reg', JSON.stringify({
                taxNumber: regData.nif.trim(),
                companyName: regData.name.trim()
            }));
            
            // Connect with Google to complete profile
            await loginWithGoogle();
        } catch (err: any) {
            setRegError(err.message || 'Erreur lors de la connexion Google.');
            localStorage.removeItem('pending_taxpayer_reg');
        } finally {
            setRegLoading(false);
        }
    };

    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#F4F7F6] p-8 font-sans overflow-hidden">
            <div className="absolute inset-0 z-0 opacity-40 mix-blend-multiply overflow-hidden">
                <div 
                    className="absolute top-[-10%] left-[-20%] w-[60%] h-[80%] blur-[150px] rounded-full animate-pulse" 
                    style={{ backgroundColor: `${theme.primary}33` }}
                />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[70%] bg-[#2C3E50]/10 blur-[120px] rounded-full" />
            </div>

            <div className="relative z-10 w-full max-w-lg animate-in fade-in slide-in-from-bottom duration-1000">
                <div className="bg-white p-10 md:p-14 rounded-[3.5rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.1)] border border-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-primary/5 rounded-full -mr-20 -mt-20 blur-2xl" />
                    
                    <header className="mb-8 text-center">
                        <img 
                            src={theme.logoUrl} 
                            alt="Logo DGI" 
                            className="w-20 h-20 mx-auto mb-6 drop-shadow-2xl bg-white p-3 rounded-2xl object-contain border border-gray-100" 
                            referrerPolicy="no-referrer" 
                        />
                        <h1 className="text-2xl md:text-3xl font-black text-[#2C3E50] tracking-tighter leading-none mb-2 italic uppercase">{theme.appName}</h1>
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.3em] leading-relaxed opacity-60">
                            Système Unifié de Communication Fiscale<br/>
                            Direction Générale des Impôts - RDC
                        </p>
                    </header>

                    {view === 'login' ? (
                        <div className="space-y-6">
                            {/* Dual Tabs for Login Type */}
                            <div className="flex bg-gray-50 p-1.5 rounded-2xl border border-gray-100 mb-4">
                                <button
                                    onClick={() => { setLoginTab('agent'); setRegError(''); }}
                                    className={cn(
                                        "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                                        loginTab === 'agent' 
                                            ? "bg-white text-primary shadow-sm ring-1 ring-black/5" 
                                            : "text-gray-400 hover:text-gray-600"
                                    )}
                                >
                                    Espace Métier (Agent)
                                </button>
                                <button
                                    onClick={() => { setLoginTab('taxpayer'); setRegError(''); }}
                                    className={cn(
                                        "flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                                        loginTab === 'taxpayer' 
                                            ? "bg-white text-primary shadow-sm ring-1 ring-black/5" 
                                            : "text-gray-400 hover:text-gray-600"
                                    )}
                                >
                                    Espace Contribuable
                                </button>
                            </div>

                            {loginTab === 'agent' ? (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    <p className="text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed max-w-xs mx-auto text-primary">
                                        ACCÈS SÉCURISÉ AGENTS & CADRES DGI
                                    </p>
                                    <p className="text-center text-[10px] text-gray-400 font-medium leading-relaxed max-w-xs mx-auto">
                                        Connexion instantanée sans mot de passe via votre adresse e-mail professionnelle certifiée.
                                    </p>
                                    <button 
                                        onClick={loginWithGoogle}
                                        disabled={authActionLoading}
                                        className={cn(
                                            "w-full group flex items-center justify-center gap-6 px-10 py-6 bg-white border-2 border-primary/20 rounded-3xl hover:border-primary hover:bg-primary/5 transition-all shadow-xl shadow-primary/5 hover:shadow-primary/10 active:scale-[0.98]",
                                            authActionLoading && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        {authActionLoading ? (
                                            <RefreshCw className="animate-spin text-primary" size={24} />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-full h-full" />
                                            </div>
                                        )}
                                        <span className="text-[10px] font-black text-primary uppercase tracking-[0.15em] transition-colors">
                                            {authActionLoading ? "Authentification..." : "Connexion Professionnelle Google"}
                                        </span>
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    <p className="text-center text-[10px] text-gray-400 font-medium leading-relaxed max-w-xs mx-auto">
                                        Espace dédié aux contribuables de la RDC. Connectez-vous instantanément et de façon sécurisée via Google. Ce portail ne requiert aucun mot de passe.
                                    </p>
                                    <button 
                                        onClick={loginWithGoogle}
                                        disabled={authActionLoading}
                                        className={cn(
                                            "w-full group flex items-center justify-center gap-6 px-10 py-6 bg-white border-2 border-gray-100 rounded-3xl hover:border-primary hover:bg-gray-50 transition-all shadow-xl shadow-gray-200/50 hover:shadow-primary/10 active:scale-[0.98]",
                                            authActionLoading && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        {authActionLoading ? (
                                            <RefreshCw className="animate-spin text-primary" size={24} />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0">
                                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-full h-full" />
                                            </div>
                                        )}
                                        <span className="text-[10px] font-black text-[#2C3E50] uppercase tracking-[0.15em] transition-colors">
                                            {authActionLoading ? "Connexion en cours..." : "Se connecter via Google"}
                                        </span>
                                    </button>
                                </div>
                            )}

                            <div className="relative flex items-center py-4">
                                <div className="flex-grow border-t border-gray-100"></div>
                                <span className="flex-shrink mx-4 text-[9px] font-black text-gray-300 uppercase tracking-widest">Nouveau contribuable ?</span>
                                <div className="flex-grow border-t border-gray-100"></div>
                            </div>

                            <button 
                                onClick={() => setView('register')}
                                className="w-full py-5 bg-primary/5 text-primary border border-primary/10 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-primary/10 transition-colors"
                            >
                                Créer un compte Contribuable
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleTaxpayerGoogleSignup} className="space-y-5 animate-in slide-in-from-right duration-500">
                             <div className="space-y-4">
                                <div className="relative">
                                    <input 
                                        required
                                        placeholder="Numéro Impôt (NIF)"
                                        className="w-full pl-6 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-4 focus:ring-primary/5 text-xs font-bold"
                                        value={regData.nif}
                                        onChange={e => setRegData({...regData, nif: e.target.value})}
                                    />
                                </div>
                                <div className="relative">
                                    <input 
                                        required
                                        placeholder="Raison Sociale / Informations Professionnelles"
                                        className="w-full pl-6 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-4 focus:ring-primary/5 text-xs font-bold"
                                        value={regData.name}
                                        onChange={e => setRegData({...regData, name: e.target.value})}
                                    />
                                </div>
                            </div>

                            {regError && (
                                <div className="p-4 bg-red-50 rounded-xl flex items-center gap-2 text-red-600 border border-red-100">
                                    <AlertCircle size={14} />
                                    <p className="text-[10px] font-black uppercase tracking-tight">{regError}</p>
                                </div>
                            )}

                            <div className="flex gap-4">
                                <button 
                                    type="button"
                                    onClick={() => setView('login')}
                                    className="flex-1 py-4 text-[10px] font-black text-gray-400 border border-gray-100 rounded-xl uppercase tracking-widest hover:bg-gray-50"
                                >
                                    Retour
                                </button>
                                <button 
                                    type="submit"
                                    disabled={regLoading || authActionLoading}
                                    className="flex-1 py-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {regLoading ? "Activation..." : "S'associer à Google"}
                                </button>
                            </div>
                        </form>
                    )}

                    <footer className="mt-12 text-center">
                        <div className="inline-flex items-center gap-3 px-6 py-2 bg-gray-50 rounded-full border border-gray-100">
                           <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                           <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest opacity-60">SÉCURITÉ D'ÉTAT CERTIFIÉE</span>
                        </div>
                    </footer>
                </div>
            </div>
        </div>
    );
};

const InternalAuthPage = () => {
    const { user, setAdminAuthenticated, setInternalAuthRequired, logout } = useAuth();
    const { theme } = useTheme();
    const [pass, setPass] = useState('');
    const [error, setError] = useState('');

    const handleUnlock = () => {
        const cleanedPass = pass.trim();
        console.log("Tentative de déverrouillage avec:", cleanedPass);
        if (user?.email === 'sibinimigjc@gmail.com') {
            if (isMasterCodeValid(pass)) {
                console.log("Accès Admin Global validé");
                setAdminAuthenticated(true);
                setInternalAuthRequired(false);
            } else {
                console.warn("Échec validation Admin Global");
                setError('Code d\'Admin Global Invalide');
            }
        } else {
            if (isMasterCodeValid(pass) || (user?.tempPassword && cleanedPass === user.tempPassword)) {
                console.log("Accès Agent validé");
                setAdminAuthenticated(true);
                setInternalAuthRequired(false);
            } else {
                console.warn("Échec validation Agent");
                setError('Code Agent Invalide');
            }
        }
    };

    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#F4F7F6] p-4 md:p-8 font-sans overflow-hidden border-t-8 border-primary relative">
            <div className="absolute inset-0 z-0 opacity-[0.05] pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary rounded-full blur-[150px]" />
            </div>
            <div className="relative z-10 w-full max-w-md animate-in zoom-in duration-500">
                <div className="bg-white p-6 md:p-12 rounded-[2.5rem] md:rounded-[3.5rem] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.15)] border border-white text-center relative overflow-hidden group">
                    <button 
                        onClick={() => logout()}
                        className="absolute top-4 right-4 p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all z-20"
                        title="Revenir à la page de connexion"
                    >
                        <X size={20} />
                    </button>
                    <img src={theme.logoUrl} alt="Logo" className="w-16 h-16 mx-auto mb-6 drop-shadow-xl bg-white p-2 rounded-2xl object-contain border border-gray-50" referrerPolicy="no-referrer" />
                    <h2 className="text-2xl md:text-3xl font-black text-[#2C3E50] uppercase tracking-tighter mb-3 md:mb-4 italic">Zone Sécurisée</h2>
                    <p className="text-[9px] md:text-[11px] text-gray-400 font-bold uppercase tracking-[0.2em] mb-8 md:mb-10 leading-relaxed opacity-80 px-4">
                        Saisie du code de sécurité requise pour {theme.appName}.
                    </p>

                    <div className="space-y-6">
                        <input 
                            type="password"
                            autoFocus
                            placeholder="••••••••"
                            className="w-full px-6 py-4 md:px-8 md:py-5 bg-gray-50 border border-gray-100 rounded-2xl md:rounded-3xl outline-none focus:ring-8 focus:ring-primary/5 focus:bg-white text-center text-xl md:text-2xl tracking-[0.5em] font-black transition-all"
                            value={pass}
                            onChange={e => setPass(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleUnlock()}
                        />
                        {error && <p className="text-[9px] font-black text-red-600 uppercase tracking-widest animate-bounce px-2">{error}</p>}
                        <button 
                            onClick={handleUnlock}
                            className="w-full py-5 md:py-6 bg-primary text-white rounded-[1.25rem] md:rounded-[1.5rem] font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 hover:brightness-110 active:scale-[0.98] transition-all"
                        >
                            Déverrouiller l'Accès
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const OnboardingPage = () => {
    const { user, logout } = useAuth();
    const { theme } = useTheme();
    const [formData, setFormData] = useState({ company: '', taxNumber: '', address: '', phone: '', companyPhotoUrl: '' });
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (user) {
            setFormData(p => ({ 
                ...p, 
                company: (user as any).companyName || '', 
                taxNumber: user.taxNumber || '', 
                address: user.address || '',
                phone: user.phone || ''
            }));
        }
    }, [user]);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;
        
        // Optimistic preview
        const localUrl = URL.createObjectURL(file);
        setFormData(p => ({ ...p, companyPhotoUrl: localUrl }));
        
        setUploading(true);
        try {
            const compressed = await compressImage(file, 512);
            const url = await uploadFile(compressed, `profiles/${user.uid}`);
            setFormData(p => ({ ...p, companyPhotoUrl: url }));
            // Also sync auth profile immediately if possible
            const { updateProfile } = await import('firebase/auth');
            await updateProfile(auth.currentUser!, { photoURL: url });
        } catch (err) {
            console.error(err);
        } finally {
            setUploading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setLoading(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                companyName: formData.company,
                taxNumber: formData.taxNumber,
                address: formData.address,
                phone: formData.phone,
                companyPhotoUrl: formData.companyPhotoUrl,
                photoURL: formData.companyPhotoUrl || user.photoURL,
                isSetup: true,
                isNew: false // No longer new after setup
            });
            await setDoc(doc(db, 'contribuables', user.uid), {
                uid: user.uid,
                email: user.email,
                taxNumber: formData.taxNumber,
                companyName: formData.company,
                role: 'contributor'
            }, { merge: true });
            window.location.reload();
        } catch (e) {
            console.error('Onboarding failed', e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#F4F7F6] flex items-center justify-center p-6 relative overflow-hidden font-sans">
            <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none">
                <div className="absolute -top-20 -left-20 w-[600px] h-[600px] bg-primary rounded-full blur-[200px]" />
                <div className="absolute -bottom-20 -right-20 w-[400px] h-[400px] bg-primary rounded-full blur-[150px]" />
            </div>

            <div className="max-w-4xl w-full bg-white rounded-[3.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row border border-white relative z-10">
                <div className="md:w-[40%] bg-primary p-16 text-white flex flex-col justify-between relative overflow-hidden">
                    <div className="relative z-10">
                        <img src={theme.logoUrl} alt="Logo" className="w-16 h-16 mb-10 drop-shadow-2xl bg-white p-2 rounded-2xl object-contain" referrerPolicy="no-referrer" />
                        <h2 className="text-4xl font-black leading-[1.1] mb-6 uppercase tracking-tighter italic">Authentification</h2>
                        <p className="text-red-100/60 text-sm font-medium leading-relaxed">Conformément au code général des impôts, chaque compte doit être rattaché à une entité juridique certifiée.</p>
                    </div>
                    
                    <div className="relative z-10 mt-20">
                        <div className="flex gap-2 mb-4">
                            {[1, 2, 3].map(i => <div key={i} className={cn("h-1 rounded-full transition-all", i === 3 ? "w-8 bg-white" : "w-1.5 bg-white/20")} />)}
                        </div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Étape de certification finale</p>
                    </div>

                    <div className="absolute -bottom-20 -right-20 w-80 h-80 bg-white/5 rounded-full blur-3xl" />
                </div>

                <div className="md:w-[60%] p-16 md:p-20">
                    <header className="mb-12">
                        <h3 className="text-2xl font-black text-[#2C3E50] mb-2">Profil du Contribuable</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest opacity-60">Veuillez renseigner les informations officielles</p>
                    </header>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="flex flex-col items-center gap-4 mb-8">
                            <div className="w-24 h-24 rounded-3xl bg-gray-50 border-2 border-dashed border-gray-200 overflow-hidden relative group">
                                {formData.companyPhotoUrl ? (
                                    <img src={formData.companyPhotoUrl} alt="Logo" className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                                        <Camera size={24} />
                                    </div>
                                )}
                                <label className="absolute inset-0 cursor-pointer opacity-0 group-hover:opacity-100 bg-primary/20 backdrop-blur-sm transition-opacity flex items-center justify-center">
                                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                                    <Plus size={20} className="text-white" />
                                </label>
                                {uploading && (
                                    <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                                        <RefreshCw size={20} className="animate-spin text-primary" />
                                    </div>
                                )}
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Logo de l'Entité <br/><span className="text-[8px] opacity-50 capitalize">Recommandé pour la certification</span></p>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">Dénomination Sociale</label>
                            <div className="relative">
                                <Building2 className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-200" size={18} />
                                <input 
                                    required
                                    className="w-full pl-16 pr-6 py-5 bg-gray-50 border border-transparent focus:border-primary/20 focus:bg-white rounded-[1.5rem] outline-none focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                    placeholder="Ex: SARL INDUSTRIE CONGO"
                                    value={formData.company}
                                    onChange={e => setFormData(p => ({ ...p, company: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">N° Identification Unique (NIU)</label>
                            <div className="relative">
                                <FileText className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-200" size={18} />
                                <input 
                                    required
                                    className="w-full pl-16 pr-6 py-5 bg-gray-50 border border-transparent focus:border-primary/20 focus:bg-white rounded-[1.5rem] outline-none focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner font-mono"
                                    placeholder="882-192-X-2024"
                                    value={formData.taxNumber}
                                    onChange={e => setFormData(p => ({ ...p, taxNumber: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">Téléphone Officiel</label>
                            <div className="relative">
                                <Phone className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-200" size={18} />
                                <input 
                                    required
                                    className="w-full pl-16 pr-6 py-5 bg-gray-50 border border-transparent focus:border-primary/20 focus:bg-white rounded-[1.5rem] outline-none focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                    placeholder="+243..."
                                    value={formData.phone}
                                    onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-2">Siège Administratif</label>
                            <div className="relative">
                                <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-200" size={18} />
                                <input 
                                    className="w-full pl-16 pr-6 py-5 bg-gray-50 border border-transparent focus:border-primary/20 focus:bg-white rounded-[1.5rem] outline-none focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                    placeholder="Gombe, Kinshasa..."
                                    value={formData.address}
                                    onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="pt-6">
                            <button 
                                type="submit"
                                disabled={loading}
                                className="w-full py-6 bg-primary text-white font-black rounded-2xl shadow-2xl shadow-primary/20 hover:brightness-110 active:scale-[0.98] transition-all uppercase tracking-[0.2em] text-xs flex items-center justify-center gap-4 group"
                            >
                                {loading ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <>
                                        <span>Activer mon portail e-échange</span>
                                        <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                    </>
                                )}
                            </button>
                            <p className="mt-6 text-center text-[10px] text-gray-400 font-bold uppercase tracking-widest opacity-40">{theme.footerText}</p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

const DirectoryPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'taxpayers' | 'staff'>('taxpayers');
    const [taxpayers, setTaxpayers] = useState<AppUser[]>([]);
    const [allUsers, setAllUsers] = useState<AppUser[]>([]);
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
    const [history, setHistory] = useState<Conversation[]>([]);
    const [deleteConfirmUser, setDeleteConfirmUser] = useState<AppUser | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [status, setStatus] = useState('');
    const [agents, setAgents] = useState<AppUser[]>([]);
    const [transferTarget, setTransferTarget] = useState<AppUser | null>(null);

    useEffect(() => {
        if (user && user.role === 'admin') {
            const q = query(collection(db, 'users'), or(where('role', '==', 'agent'), where('role', '==', 'admin')));
            return onSnapshot(q, (snap) => {
                setAgents(snap.docs.map(d => ({ uid: d.id, ...d.data() } as unknown as AppUser)));
            }, (err) => handleFirestoreError(err, OperationType.LIST, 'users_transfer_targets'));
        }
    }, [user]);

    const handleTransfer = async (taxpayerId: string, agent: AppUser) => {
        try {
            await updateDoc(doc(db, 'users', taxpayerId), {
                assignedAgentId: agent.uid,
                assignedAgentName: agent.displayName,
                assignedAgentEmail: agent.email,
                updatedAt: serverTimestamp()
            });

            // Retroactively assign existing conversations to the agent too
            const convsSnap = await getDocs(query(
                collection(db, 'conversations'), 
                where('contributorId', '==', taxpayerId)
            ));
            for (const convDoc of convsSnap.docs) {
                await updateDoc(convDoc.ref, {
                    agentId: agent.uid,
                    assignedAgentId: agent.uid,
                    assignedAgentEmail: agent.email,
                    assignedAgentName: agent.displayName
                });
            }

            setTransferTarget(null);
            setStatus("Dossier transféré avec succès.");
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        if (!user) return;
        const isSuper = (user as any).isSuperContribuable;
        if (user.role === 'contributor' && !isSuper) return;

        const baseQuery = (user.role === 'admin' || isSuper) 
            ? query(collection(db, 'users'))
            : query(
                collection(db, 'users'),
                and(
                    where('role', 'in', ['agent', 'admin']),
                    or(
                        where('assignedAgentId', '==', null),
                        where('assignedAgentId', '==', user.uid)
                    )
                )
            );

        const unsub = onSnapshot(baseQuery, (snap) => {
            const all = snap.docs.map(d => ({ ...d.data(), uid: d.id } as AppUser));
            setAllUsers(all);
            if (activeTab === 'taxpayers') {
                const list = all.filter(u => u.role === 'contributor');
                if (user.role === 'agent' && !user.permissions?.includes('admin_view')) {
                    setTaxpayers(list.filter(t => t.assignedAgentId === user.uid || !t.assignedAgentId)); // Include unassigned
                } else {
                    setTaxpayers(list);
                }
            } else {
                setTaxpayers(all.filter(u => u.role === 'agent' || u.role === 'admin'));
            }
        }, (err) => handleFirestoreError(err, OperationType.LIST, 'users_all'));
        return () => unsub();
    }, [user, activeTab]);

    useEffect(() => {
        if (selectedUser && user && user.role !== 'contributor') {
            const isSuperAdmin = user.email === 'sibinimigjc@gmail.com';
            let q;
            if (isSuperAdmin) {
                q = query(
                    collection(db, 'conversations'), 
                    where('participants', 'array-contains', selectedUser.uid)
                );
            } else {
                q = query(
                    collection(db, 'conversations'), 
                    where('assignedAgentId', '==', user.uid)
                );
            }
            return onSnapshot(q, (snap) => {
                let list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation));
                if (!isSuperAdmin) {
                    list = list.filter(c => c.participants.includes(selectedUser.uid));
                }
                list.sort((a, b) => {
                    const tA = a.lastUpdate?.toMillis ? a.lastUpdate.toMillis() : (a.lastUpdate?.seconds ? a.lastUpdate.seconds * 1000 : 0);
                    const tB = b.lastUpdate?.toMillis ? b.lastUpdate.toMillis() : (b.lastUpdate?.seconds ? b.lastUpdate.seconds * 1000 : 0);
                    return tB - tA;
                });
                setHistory(list);
            }, (err) => handleFirestoreError(err, OperationType.LIST, `conversations_history_${selectedUser.uid}`));
        }
    }, [selectedUser, user]);

    const filtered = taxpayers.filter(t => 
        t.displayName.toLowerCase().includes(search.toLowerCase()) || 
        t.companyName?.toLowerCase().includes(search.toLowerCase()) ||
        t.taxNumber?.includes(search)
    ).sort((a,b) => (a.companyName || a.displayName).localeCompare(b.companyName || b.displayName));

    const handleDeleteContribuable = async () => {
        if (!deleteConfirmUser || !user || !hasPermission(user, 'deletion')) return;
        setIsDeleting(true);
        try {
            const uid = deleteConfirmUser.uid;
            const batch = writeBatch(db);

            // 1. Clean up conversations & messages
            const convsSnap = await getDocs(query(collection(db, 'conversations'), where('participants', 'array-contains', uid)));
            for (const convDoc of convsSnap.docs) {
                const msgsSnap = await getDocs(collection(db, 'conversations', convDoc.id, 'messages'));
                msgsSnap.docs.forEach(m => batch.delete(m.ref));
                batch.delete(convDoc.ref);
            }

            // 2. Internal messages cleanup
            const internalMsgsSnap = await getDocs(query(collection(db, 'internal_messages'), where('participants', 'array-contains', uid)));
            internalMsgsSnap.docs.forEach(m => batch.delete(m.ref));

            // 3. Delete user document
            batch.delete(doc(db, 'users', uid));

            await batch.commit();

            // 4. Storage cleanup
            if (deleteConfirmUser.photoURL && deleteConfirmUser.photoURL.includes('firebasestorage')) {
                try {
                    const storageRef = ref(storage, deleteConfirmUser.photoURL);
                    await deleteObject(storageRef);
                } catch (e) {
                    console.warn("Storage skip:", e);
                }
            }

            setStatus("Contribuable supprimé avec succès.");
            setDeleteConfirmUser(null);
        } catch (error) {
            console.error(error);
            alert("Erreur lors de la suppression sécurisée.");
        } finally {
            setIsDeleting(false);
            setTimeout(() => setStatus(''), 4000);
        }
    };

    return (
        <div className="p-10 h-full flex flex-col bg-[#F4F7F6] font-sans relative">
            {status && (
                <div className="fixed top-20 right-10 z-[100] animate-in slide-in-from-right duration-500">
                    <div className="bg-green-600 text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 border-2 border-white/20">
                        <CheckCircle2 size={24} />
                        <span className="text-xs font-black uppercase tracking-widest">{status}</span>
                    </div>
                </div>
            )}

            <header className="mb-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6 shrink-0">
                <div>
                    <h1 className="text-3xl md:text-4xl font-black text-[#2C3E50] tracking-tight uppercase italic underline decoration-primary/20 decoration-8 underline-offset-8">Annuaire National</h1>
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-[0.2em] mt-3 opacity-60">Registre centralisé et sécurisé de la DGI</p>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex p-1 bg-gray-200/50 rounded-2xl shadow-inner border border-white/40">
                        <button 
                            onClick={() => setActiveTab('taxpayers')}
                            className={cn("px-6 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all", activeTab === 'taxpayers' ? "bg-white text-primary shadow-lg" : "text-gray-400 hover:text-gray-600")}
                        >
                            Contribuables
                        </button>
                        <button 
                            onClick={() => setActiveTab('staff')}
                            className={cn("px-6 py-2 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all", activeTab === 'staff' ? "bg-white text-primary shadow-lg" : "text-gray-400 hover:text-gray-600")}
                        >
                            Personnel DGI
                        </button>
                    </div>

                    <div className="relative w-full sm:w-80 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-primary transition-colors" size={18} />
                        <input 
                            placeholder="Recherche rapide..." 
                            className="w-full pl-12 pr-6 py-4 bg-white border border-gray-100 rounded-2xl outline-none text-xs font-bold transition-all focus:ring-4 focus:ring-primary/5 shadow-xl shadow-gray-500/5 placeholder:text-gray-300"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                </div>
            </header>

            <div className="bg-white rounded-[3rem] border border-gray-100 shadow-2xl shadow-gray-500/5 overflow-hidden flex-1 flex flex-col min-h-0">
                <div className="overflow-auto flex-1">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100 sticky top-0 z-10 backdrop-blur-md">
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] w-[35%]">{activeTab === 'taxpayers' ? 'Contribuable' : 'Personnel DGI'}</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] w-[20%]">{activeTab === 'taxpayers' ? 'NIU' : 'Email'}</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] w-[20%]">{activeTab === 'taxpayers' ? 'Rapports / Rôle' : 'Rôle'}</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="py-20 text-center opacity-20">
                                        <div className="max-w-xs mx-auto">
                                            <Search size={64} className="mx-auto mb-4" />
                                            <p className="text-xs font-black uppercase tracking-widest leading-relaxed">AUCUN CONTRIBUABLE TROUVÉ DANS CETTE SECTION</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(t => (
                                    <tr key={t.uid} className="hover:bg-primary/5 transition-all group cursor-pointer" onClick={() => setSelectedUser(t)}>
                                        <td className="px-10 py-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-white border border-gray-100 rounded-xl overflow-hidden flex-shrink-0 shadow-sm flex items-center justify-center">
                                                    {(t.companyPhotoUrl || t.photoURL) ? (
                                                        <img src={t.companyPhotoUrl || t.photoURL} alt="" className="w-full h-full object-contain p-1" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-gray-50 text-primary font-black text-xs uppercase">
                                                            {(t.companyName || t.displayName)[0]}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-black text-[#2C3E50] uppercase tracking-tight leading-none mb-1.5 truncate max-w-[200px] group-hover:text-primary transition-colors">
                                                        {activeTab === 'taxpayers' ? (t.companyName || t.displayName) : t.displayName}
                                                    </p>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest truncate">
                                                        {activeTab === 'taxpayers' ? `Responsable: ${t.displayName}` : `ID: ${t.uid.slice(-6)}`}
                                                    </p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-10 py-6">
                                            {activeTab === 'taxpayers' ? (
                                                <span className="px-4 py-1.5 bg-gray-50 text-primary border border-primary/10 rounded-full text-[10px] font-bold tabular-nums">
                                                    {hasPermission(user, 'tax_consultation') ? (t.taxNumber || 'NIU-PENDING') : '********'}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-gray-500 lowercase tracking-normal">{t.email}</span>
                                            )}
                                        </td>
                                        <td className="px-10 py-6">
                                            {activeTab === 'taxpayers' ? (
                                                <div className="flex items-center gap-2">
                                                    <div className="p-2 bg-gray-50 rounded-lg text-primary">
                                                        <Shield size={14} />
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-black text-[#2C3E50] truncate max-w-[120px]">{t.assignedAgentName || "NON ATTRIBUÉ"}</p>
                                                        <p className="text-[8px] text-gray-400 font-bold uppercase tracking-widest leading-none">Agent</p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <div className={cn(
                                                        "px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest",
                                                        t.role === 'admin' ? "bg-red-50 text-red-600 border border-red-100" : "bg-blue-50 text-blue-600 border border-blue-100"
                                                    )}>
                                                        {t.role === 'admin' ? 'Administrateur' : 'Agent DGI'}
                                                    </div>
                                                    {((user as any).isSuperContribuable || user?.role === 'admin') && t.role !== 'admin' && (
                                                       <span className="text-[10px] font-black text-primary uppercase tracking-widest ml-1 bg-primary/5 px-2 py-1 rounded-lg">
                                                          {allUsers.filter(u => u.assignedAgentId === t.uid).length} Dossiers
                                                       </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-10 py-6 text-right">
                                            <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
                                                {user?.role === 'admin' && activeTab === 'taxpayers' && (
                                                    <button 
                                                        onClick={() => setTransferTarget(t)}
                                                        className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-all shadow-sm"
                                                        title="Transférer"
                                                    >
                                                        <ArrowRightLeft size={16} />
                                                    </button>
                                                )}
                                                {hasPermission(user, 'deletion') && activeTab === 'taxpayers' && (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDeleteConfirmUser(t);
                                                        }}
                                                        className="p-3 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                                        title="Supprimer définitivement"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                                {(activeTab === 'staff' || (user as any).isSuperContribuable) && t.uid !== user?.uid ? (
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigate('/messaging', { state: { receiverId: t.uid, subject: `Contact Agent ${t.displayName}` } });
                                                        }}
                                                        className="px-6 py-2 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all flex items-center gap-2"
                                                    >
                                                        <MessageSquare size={14} /> {activeTab === 'staff' ? 'Chat Privé' : 'Contacter'}
                                                    </button>
                                                ) : (
                                                    <button className="px-6 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:border-primary hover:text-primary transition-all">Historique</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* History Modal */}
            {selectedUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-[3rem] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-white animate-in zoom-in duration-300">
                        <header className="p-10 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-4">
                                <div className="w-16 h-16 rounded-[1.5rem] bg-white border border-gray-100 flex items-center justify-center overflow-hidden shadow-sm">
                                    {(selectedUser.companyPhotoUrl || selectedUser.photoURL) ? (
                                        <img src={selectedUser.companyPhotoUrl || selectedUser.photoURL} alt="" className="w-full h-full object-contain p-2" referrerPolicy="no-referrer" />
                                    ) : (
                                        <div className="text-primary text-2xl font-black">
                                            {(selectedUser.companyName || selectedUser.displayName)[0]}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-2xl font-black text-[#2C3E50] uppercase tracking-tighter italic">{selectedUser.displayName}</h3>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Profil & Coordonnées Officiels</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedUser(null)} className="p-3 bg-gray-50 text-gray-400 hover:text-primary rounded-2xl transition-all"><X size={24} /></button>
                        </header>
                        <div className="flex-1 overflow-y-auto p-10 bg-white">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                                <div className="lg:col-span-1 space-y-8">
                                    <div className="bg-gray-50/50 p-8 rounded-[2.5rem] border border-gray-100 shadow-inner">
                                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6">Informations de Contact</h4>
                                        <div className="space-y-6">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 bg-white rounded-xl shadow-sm text-primary"><Mail size={16} /></div>
                                                <div className="min-w-0">
                                                    <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Email Professionnel</p>
                                                    <p className="text-xs font-bold text-[#2C3E50] truncate">{selectedUser.email}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 bg-white rounded-xl shadow-sm text-primary"><Search size={16} /></div>
                                                <div className="min-w-0">
                                                    <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Téléphone / WhatsApp</p>
                                                    <p className="text-xs font-bold text-[#2C3E50]">{selectedUser.phone || "Non renseigné"}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="p-2 bg-white rounded-xl shadow-sm text-primary"><MapPin size={16} /></div>
                                                <div className="min-w-0">
                                                    <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Siège / Localisation</p>
                                                    <p className="text-xs font-bold text-[#2C3E50]">{selectedUser.address || "Non renseignée"}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {selectedUser.role === 'contributor' && (
                                        <div className="bg-primary/5 p-8 rounded-[2.5rem] border border-primary/10">
                                            <h4 className="text-[10px] font-black text-primary uppercase tracking-widest mb-6">Identification Fiscale</h4>
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">NIU</span>
                                                    <span className="text-xs font-black text-[#2C3E50]">{selectedUser.taxNumber || "EN ATTENTE"}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Entreprise</span>
                                                    <span className="text-xs font-black text-[#2C3E50] truncate max-w-[150px]">{selectedUser.companyName || "N/A"}</span>
                                                </div>
                                                <div className="pt-4 mt-4 border-t border-primary/10">
                                                    <div className="flex items-center justify-between mb-4">
                                                        <div>
                                                            <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest mb-2">Agent Responsable</p>
                                                            <div className="flex items-center gap-2">
                                                                <Shield size={12} className="text-primary" />
                                                                <span className="text-[11px] font-black text-[#2C3E50]">{selectedUser.assignedAgentName || "NON ATTRIBUÉ"}</span>
                                                            </div>
                                                        </div>
                                                        {user?.role === 'admin' && selectedUser.assignedAgentId && (
                                                            <button 
                                                                onClick={async () => {
                                                                    if (confirm("Détacher ce gestionnaire et remettre le dossier en canal public ?")) {
                                                                        await updateDoc(doc(db, 'users', selectedUser.uid), {
                                                                            assignedAgentId: null,
                                                                            assignedAgentName: null
                                                                        });
                                                                        setSelectedUser(null);
                                                                        setStatus("Gestionnaire détaché. Dossier libre.");
                                                                    }
                                                                }}
                                                                className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-all shadow-sm"
                                                                title="Détacher le gestionnaire"
                                                            >
                                                                <UserMinus size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    
                                                    {user?.role === 'admin' && (
                                                        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                                                            <div>
                                                                <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest">Super Contribuable</p>
                                                                <p className="text-[7px] text-gray-300 italic">Accès banque/visuel global</p>
                                                            </div>
                                                            <button 
                                                                onClick={async () => {
                                                                    const isSuper = (selectedUser as any).isSuperContribuable;
                                                                    await updateDoc(doc(db, 'users', selectedUser.uid), {
                                                                        isSuperContribuable: !isSuper,
                                                                        role: 'contributor' // Ensure it remains a contributor
                                                                    });
                                                                    setSelectedUser(prev => prev ? { ...prev, isSuperContribuable: !isSuper } as any : null);
                                                                    setStatus(isSuper ? "Statut Super Contribuable retiré" : "Promu Super Contribuable (Mode Banque Activé)");
                                                                }}
                                                                className={cn(
                                                                    "w-10 h-5 rounded-full transition-all relative",
                                                                    (selectedUser as any).isSuperContribuable ? "bg-green-500" : "bg-gray-200"
                                                                )}
                                                            >
                                                                <div className={cn(
                                                                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                                                                    (selectedUser as any).isSuperContribuable ? "left-6" : "left-1"
                                                                )} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {selectedUser.role === 'agent' && ((user as any).isSuperContribuable || user?.role === 'admin') && (
                                        <div className="bg-primary/5 p-8 rounded-[2.5rem] border border-primary/10">
                                            <h4 className="text-[10px] font-black text-primary uppercase tracking-widest mb-6">Dossiers Assignés</h4>
                                            <div className="space-y-3 max-h-60 overflow-y-auto pr-2 scrollbar-hide">
                                                {allUsers.filter(u => u.assignedAgentId === selectedUser.uid).length === 0 ? (
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase text-center py-4">Aucun dossier lié</p>
                                                ) : (
                                                    allUsers.filter(u => u.assignedAgentId === selectedUser.uid).map(tax => (
                                                        <div key={tax.uid} className="flex items-center justify-between p-3 bg-white rounded-xl shadow-sm border border-gray-100">
                                                            <div className="min-w-0 flex-1 mr-4">
                                                                <p className="text-[10px] font-black text-[#2C3E50] truncate uppercase">{tax.companyName || tax.displayName}</p>
                                                                <p className="text-[8px] text-gray-400 font-bold tracking-widest">{tax.taxNumber}</p>
                                                            </div>
                                                            <button 
                                                                onClick={() => setSelectedUser(tax)}
                                                                className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-all"
                                                            >
                                                                <Eye size={12} />
                                                            </button>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {(selectedUser.role === 'agent' || selectedUser.role === 'admin') && (
                                        <div className="bg-[#2C3E50] p-8 rounded-[2.5rem] text-white">
                                            <h4 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-6">Statut hiérarchique</h4>
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">Rôle</span>
                                                    <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-widest">{selectedUser.role}</span>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">ID Agent</span>
                                                    <span className="text-xs font-mono font-bold text-white/80">{selectedUser.uid.slice(-8).toUpperCase()}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="lg:col-span-2 flex flex-col min-h-0">
                                    <div className="flex items-center gap-4 mb-6 px-2">
                                        <History size={20} className="text-primary" />
                                        <h4 className="text-sm font-black text-[#2C3E50] uppercase tracking-tighter italic">Historique des Interactions</h4>
                                    </div>
                                    
                                    <div className="flex-1 overflow-y-auto pr-2 space-y-4 max-h-[500px]">
                                        {history.length === 0 ? (
                                            <div className="text-center py-24 bg-gray-50/50 rounded-[2.5rem] border border-dashed border-gray-200">
                                                <Mail size={48} className="mx-auto mb-4 opacity-10" />
                                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Aucun historique disponible</p>
                                            </div>
                                        ) : (
                                            history.map(c => (
                                                <div key={c.id} className="bg-white p-6 rounded-3xl border border-gray-100 hover:border-primary/20 transition-all cursor-pointer shadow-sm hover:shadow-md" onClick={() => { setSelectedUser(null); navigate('/messaging'); }}>
                                                    <div className="flex justify-between items-start mb-3">
                                                        <h4 className="text-xs font-black text-[#2C3E50] uppercase tracking-tight">{c.subject}</h4>
                                                        <span className="text-[10px] font-bold text-gray-400 tabular-nums">
                                                            {c.lastUpdate?.toDate() ? c.lastUpdate.toDate().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-gray-500 font-medium leading-relaxed line-clamp-2 italic">"{c.lastMessagePreview}"</p>
                                                    <div className="mt-4 flex items-center justify-between pt-4 border-t border-gray-50">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn("w-1.5 h-1.5 rounded-full", c.status === 'open' ? "bg-green-500" : "bg-gray-300")} />
                                                            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-400">{c.status}</span>
                                                        </div>
                                                        <span className="flex items-center gap-1 text-[9px] font-black text-primary uppercase tracking-widest">
                                                            Consulter
                                                            <ArrowRight size={10} />
                                                        </span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <footer className="p-8 border-t border-gray-100 bg-white shrink-0 text-center">
                            <button 
                                onClick={() => setSelectedUser(null)}
                                className="px-10 py-4 bg-primary text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-primary/20 hover:brightness-110 transition-all"
                            >
                                Fermer le Registre
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {/* Transfer Modal */}
            {transferTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
                    <div className="bg-white p-8 md:p-12 rounded-[3.5rem] shadow-2xl max-w-md w-full border border-white animate-in zoom-in duration-300">
                        <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-[1.5rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
                            <ArrowRightLeft size={40} />
                        </div>
                        <h2 className="text-2xl font-black text-[#2C3E50] text-center mb-2 italic">Transfert de Dossier</h2>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest text-center mb-10">{transferTarget.companyName}</p>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-2">Nouvel Agent Assigné</label>
                                <select 
                                    className="w-full px-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl text-xs font-black outline-none"
                                    onChange={e => {
                                        const agent = agents.find(a => a.uid === e.target.value);
                                        if (agent) handleTransfer(transferTarget.uid, agent);
                                    }}
                                    defaultValue=""
                                >
                                    <option value="" disabled>Sélectionner un agent...</option>
                                    {agents.map(a => (
                                        <option key={a.uid} value={a.uid}>{a.displayName} ({a.role})</option>
                                    ))}
                                </select>
                            </div>
                            <button 
                                onClick={() => setTransferTarget(null)}
                                className="w-full py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"
                            >
                                Annuler
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal 
                isOpen={!!deleteConfirmUser}
                onClose={() => setDeleteConfirmUser(null)}
                onConfirm={handleDeleteContribuable}
                loading={isDeleting}
                title="Suppression Définitive"
                message={`Êtes-vous sûr de vouloir supprimer définitivement ${deleteConfirmUser?.companyName || deleteConfirmUser?.displayName} ? Toutes ses informations (NIU, adresse, historique des conversations et fichiers) seront effacées de manière irrévocable.`}
            />
        </div>
    );
};

const InternalChatPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const location = useLocation() as any;
    const [agents, setAgents] = useState<AppUser[]>([]);
    const [selectedAgent, setSelectedAgent] = useState<AppUser | null>(null);
    const [messages, setMessages] = useState<InternalMessage[]>([]);
    const [newMsg, setNewMsg] = useState('');
    const [tempAttachments, setTempAttachments] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [searchAgent, setSearchAgent] = useState('');
    const [activeTab, setActiveTab] = useState<'public' | 'private'>('public');
    const [uploadProgress, setUploadProgress] = useState<number[]>([]);

    const handleInternalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []) as File[];
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        const valid = files.filter(f => {
            if (f.size > 5 * 1024 * 1024) { alert(`Fichier ${f.name} trop large (Max 5Mo)`); return false; }
            if (!allowed.includes(f.type)) { alert(`Format ${f.name} non supporté`); return false; }
            return true;
        });
        if (tempAttachments.length + valid.length > 10) { alert("Max 10 fichiers"); return; }
        setTempAttachments(prev => [...prev, ...valid]);
        setUploadProgress(prev => [...prev, ...valid.map(() => 0)]);
    };

    useEffect(() => {
        if (!user || user.role === 'contributor') {
            setAgents([]);
            return;
        }

        const q = query(collection(db, 'users'), where('role', 'in', ['admin', 'agent']));
        const unsub = onSnapshot(q, 
            (snap) => setAgents(snap.docs.map(d => ({ ...d.data(), uid: d.id } as AppUser))),
            (err) => handleFirestoreError(err, OperationType.LIST, 'users_staff')
        );
        return () => unsub();
    }, [user?.uid, user?.role]);

    useEffect(() => {
        if (!user || user.role === 'contributor') return;

        let q;
        if (activeTab === 'public') {
            q = query(
                collection(db, 'canal_general_staff'),
                orderBy('createdAt', 'asc'),
                limit(100)
            );
        } else if (selectedAgent) {
            // Rule 2: Highly optimized query targeting the selected private thread directly on Firestore
            const threadId = [user.uid, selectedAgent.uid].sort().join('_');
            q = query(
                collection(db, 'internal_messages'),
                where('channel', '==', 'private'),
                where('threadId', '==', threadId),
                orderBy('createdAt', 'asc'),
                limit(150)
            );
        } else {
            // Private: remove orderBy to avoid index requirement for composite queries
            if (user.role === 'admin') {
                q = query(
                    collection(db, 'internal_messages'),
                    where('channel', '==', 'private'),
                    limit(400)
                );
            } else {
                q = query(
                    collection(db, 'internal_messages'),
                    where('channel', '==', 'private'),
                    where('participants', 'array-contains', user.uid),
                    limit(200)
                );
            }
        }

        const unsub = onSnapshot(q, 
            (snap) => {
                let all = snap.docs.map(d => ({ id: d.id, ...d.data() } as InternalMessage));
                
                // Sorting client-side to keep layout consistently chronological
                all.sort((a, b) => {
                    const timeA = a.createdAt?.toMillis() || 0;
                    const timeB = b.createdAt?.toMillis() || 0;
                    return timeA - timeB; 
                });

                setMessages(all);
            },
            (err) => handleFirestoreError(err, OperationType.LIST, activeTab === 'public' ? 'canal_general_staff' : 'internal_messages')
        );
        return () => unsub();
    }, [user?.uid, user?.role, activeTab, selectedAgent?.uid]);

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (uploading) return;
        if (!user) return;
        if (activeTab === 'private' && !selectedAgent) return;
        if (!newMsg.trim() && tempAttachments.length === 0) return;

        setUploading(true);
        setUploadProgress(Array(tempAttachments.length).fill(0));
        try {
            const uploaded: Attachment[] = [];
            for (let i = 0; i < tempAttachments.length; i++) {
                const file = tempAttachments[i];
                const url = await uploadFile(file, `internal/${user.uid}`, (p) => {
                    setUploadProgress(prev => {
                        const copy = [...prev];
                        copy[i] = Math.round(p);
                        return copy;
                    });
                });
                uploaded.push({ url, name: file.name, type: file.type });
            }

            const currentThreadId = activeTab === 'private' && selectedAgent 
                ? [user.uid, selectedAgent.uid].sort().join('_') 
                : (activeTab === 'public' ? 'staff_general' : null);

            const msgData: any = {
                text: newMsg.trim(),
                senderId: user.uid,
                senderName: user.displayName,
                senderRole: user.role === 'admin' ? 'Administrateur' : ((user as any).agentRole || 'Agent DGI'),
                channel: activeTab,
                threadId: currentThreadId,
                attachments: uploaded,
                createdAt: serverTimestamp(),
                participants: activeTab === 'private' ? [user.uid, selectedAgent!.uid].sort() : [],
                replyTo: replyTo ? { id: replyTo.id, text: replyTo.text, senderName: replyTo.senderName } : null
            };

            const coll = activeTab === 'public' ? 'canal_general_staff' : 'internal_messages';
            await addDoc(collection(db, coll), msgData);
            setNewMsg('');
            setReplyTo(null);
            setTempAttachments([]);
            setUploadProgress([]);
        } catch (e: any) {
            console.error(e);
            alert("Échec de l'envoi interne: " + e.message);
        } finally {
            setUploading(false);
        }
    };

    const [isInternalDeleteConfirmOpen, setIsInternalDeleteConfirmOpen] = useState(false);
    useEffect(() => {
        if (location.state?.targetAgent) {
            setSelectedAgent(location.state.targetAgent);
            setActiveTab('private');
            // Clean up state to avoid re-triggering
            window.history.replaceState({}, document.title);
        }
    }, [location.state]);
    const [msgToDelete, setMsgToDelete] = useState<InternalMessage | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [replyTo, setReplyTo] = useState<InternalMessage | null>(null);

    const deleteInternalMsg = async () => {
        if (!msgToDelete || !user) return;
        setDeleting(true);
        try {
            // Delete attachments
            if (msgToDelete.attachments) {
                for (const att of msgToDelete.attachments) {
                    try {
                        await deleteObject(ref(storage, att.url));
                    } catch (e) { console.warn("Internal storage delete skip", e); }
                }
            }
            const coll = msgToDelete.channel === 'public' ? 'canal_general_staff' : 'internal_messages';
            await deleteDoc(doc(db, coll, msgToDelete.id));
            setIsInternalDeleteConfirmOpen(false);
            setMsgToDelete(null);
        } catch (e: any) {
            alert("Erreur de suppression interne: " + e.message);
        } finally {
            setDeleting(false);
        }
    };

    const filteredAgents = agents.filter(a => 
        a.uid !== user?.uid && 
        (a.displayName.toLowerCase().includes(searchAgent.toLowerCase()) || a.email.toLowerCase().includes(searchAgent.toLowerCase()))
    );

    const recentPrivateAgents = activeTab === 'private' ? [...messages].sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || 0;
        const timeB = b.createdAt?.toMillis() || 0;
        return timeB - timeA;
    }).reduce((acc: AppUser[], m) => {
        const otherId = m.participants?.find(p => p !== user?.uid);
        if (otherId && !acc.find(a => a.uid === otherId)) {
            const agent = agents.find(a => a.uid === otherId);
            if (agent) acc.push(agent);
        }
        return acc;
    }, []).slice(0, 15) : [];

    const [isNewDiscussionOpen, setIsNewDiscussionOpen] = useState(false);

    // Rule 2: Remove heavy client-side filtering since messages are already optimally loaded by the db query
    const displayMessages = messages;

    const inboxMessages = activeTab === 'private' && !selectedAgent 
        ? [...messages].sort((a, b) => {
            const timeA = a.createdAt?.toMillis() || 0;
            const timeB = b.createdAt?.toMillis() || 0;
            return timeB - timeA;
        })
        : displayMessages;

    return (
        <div className="flex-1 flex flex-col md:flex-row bg-[#F4F7F6] h-full overflow-hidden font-sans">
            <div className={cn(
                "w-full md:w-80 bg-white border-r border-gray-100 flex flex-col shrink-0 transition-all",
                (selectedAgent || (activeTab === 'public' && messages.length > 0)) && "hidden md:flex"
            )}>
                <div className="p-8 border-b border-gray-50 bg-gray-50/30">
                    <h2 className="text-xl font-black text-[#2C3E50] uppercase tracking-tighter italic mb-6">Conversations Staff</h2>
                    <div className="flex p-1 bg-gray-100/50 border border-gray-100 rounded-xl mb-6 relative">
                        <button 
                            onClick={() => { setActiveTab('public'); setSelectedAgent(null); }}
                            className={cn(
                                "flex-1 py-1.5 md:py-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 px-1 relative z-10", 
                                activeTab === 'public' ? "text-primary" : "text-gray-400 hover:text-gray-600"
                            )}
                        >
                            <Layers size={14} />
                            Fils Publics
                        </button>
                        <button 
                            onClick={() => setActiveTab('private')}
                            className={cn(
                                "flex-1 py-1.5 md:py-2 text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-lg transition-all flex items-center justify-center gap-2 px-1 relative z-10", 
                                activeTab === 'private' ? "text-primary" : "text-gray-400 hover:text-gray-600"
                            )}
                        >
                            <User size={14} />
                            Fils Privés
                        </button>
                        <motion.div 
                            layoutId="activeInternalTab"
                            className="absolute inset-y-1 rounded-lg bg-white shadow-sm border-b-2 border-primary/30"
                            initial={false}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            style={{ 
                                width: 'calc(50% - 4px)',
                                left: activeTab === 'public' ? '4px' : 'calc(50%)'
                            }}
                        />
                    </div>

                    {activeTab === 'private' && (
                        <div className="relative animate-in fade-in slide-in-from-top duration-300">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                            <input 
                                className="w-full pl-10 pr-4 py-3 bg-white border border-gray-100 rounded-xl outline-none focus:ring-4 focus:ring-primary/5 text-xs font-bold transition-all shadow-sm"
                                placeholder="Rechercher Agent..."
                                value={searchAgent}
                                onChange={e => setSearchAgent(e.target.value)}
                            />
                        </div>
                    )}
                </div>
                
                {activeTab === 'private' ? (
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-2">Récentes</p>
                            <button 
                                onClick={() => setIsNewDiscussionOpen(true)}
                                className="p-2 bg-primary/10 text-primary rounded-lg hover:bg-primary hover:text-white transition-all"
                                title="Nouvelle Discussion"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                                {recentPrivateAgents.map(a => (
                                    <button 
                                        key={a.uid}
                                        onClick={() => setSelectedAgent(a)}
                                        className={cn(
                                            "w-full flex items-center gap-3 p-3 rounded-xl transition-all group",
                                            selectedAgent?.uid === a.uid ? "bg-primary text-white shadow-lg" : "hover:bg-gray-100"
                                        )}
                                    >
                                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center font-black uppercase text-xs shadow-inner shrink-0", selectedAgent?.uid === a.uid ? "bg-white text-primary" : "bg-gray-100 text-primary")}>
                                            {a.displayName[0]}
                                        </div>
                                        <p className="text-[10px] font-black truncate">{a.displayName}</p>
                                    </button>
                                ))}
                        
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-2 mb-2">
                            {searchAgent ? 'Résultats' : 'Tous les Agents'}
                        </p>
                        {filteredAgents.map(a => (
                            <button 
                                key={a.uid}
                                onClick={() => setSelectedAgent(a)}
                                className={cn(
                                    "w-full flex items-center gap-4 p-4 rounded-2xl transition-all group",
                                    selectedAgent?.uid === a.uid ? "bg-primary text-white shadow-xl shadow-primary/20 scale-[1.02]" : "hover:bg-gray-50"
                                )}
                            >
                                <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center font-black uppercase text-sm shrink-0 shadow-inner",
                                    selectedAgent?.uid === a.uid ? "bg-white/20" : "bg-gray-100 text-gray-400 group-hover:bg-primary/10 group-hover:text-primary"
                                )}>
                                    {a.displayName[0]}
                                </div>
                                <div className="text-left min-w-0">
                                    <p className="text-xs font-black truncate leading-none mb-1">{a.displayName}</p>
                                    <p className={cn("text-[8px] font-bold uppercase tracking-widest truncate", selectedAgent?.uid === a.uid ? "text-white/60" : "text-gray-400")}>{(a as any).agentRole || a.role}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="p-12 text-center opacity-30">
                        <Layers size={48} className="mx-auto mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest leading-relaxed">Discussion Staff</p>
                    </div>
                )}
            </div>

            <div className="flex-1 flex flex-col relative overflow-hidden bg-white">
                {activeTab === 'private' && !selectedAgent ? (
                    <div className="flex-1 flex flex-col bg-white overflow-hidden animate-in fade-in zoom-in duration-500">
                        <header className="p-8 md:p-12 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/20">
                            <div className="flex items-center gap-4 md:gap-6">
                                <div className="w-12 h-12 md:w-16 md:h-16 bg-primary text-white rounded-[1.5rem] md:rounded-[2.5rem] flex items-center justify-center shadow-xl shadow-primary/20">
                                    <Mail size={32} />
                                </div>
                                <div>
                                    <h2 className="text-xl md:text-3xl font-black text-[#2C3E50] uppercase tracking-tighter italic leading-none">Canal Privé</h2>
                                    <p className="text-[10px] md:text-xs text-gray-400 font-bold uppercase tracking-widest mt-1 md:mt-2">Échanges confidentiels entre agents de la DGI</p>
                                </div>
                            </div>
                        </header>
                        <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-4 md:space-y-6 bg-gray-50/50 scrollbar-hide">
                            {recentPrivateAgents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-8 animate-in fade-in duration-700">
                                    <div className="w-24 h-24 bg-red-50 text-primary rounded-[2.5rem] flex items-center justify-center shadow-inner animate-pulse">
                                        <MessageSquare size={48} />
                                    </div>
                                    <div>
                                        <h3 className="text-2xl font-black text-[#2C3E50] uppercase italic tracking-tighter mb-2">Pas de discussions</h3>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest max-w-[240px] mx-auto leading-relaxed">
                                            Cet espace est confidentiel. Sélectionnez un collègue ci-dessous pour entamer un dialogue.
                                        </p>
                                    </div>
                                    <div className="w-full max-w-sm grid gap-2">
                                        <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest mb-2">Agents Recommandés</p>
                                        {filteredAgents.slice(0, 4).map(a => (
                                            <button 
                                                key={a.uid} 
                                                onClick={() => setSelectedAgent(a)}
                                                className="w-full flex items-center gap-4 p-4 bg-white border border-gray-100 rounded-2xl hover:border-primary/20 hover:scale-[1.02] transition-all shadow-sm group"
                                            >
                                                <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-primary font-black uppercase text-xs shadow-inner group-hover:bg-primary group-hover:text-white transition-all">
                                                    {a.displayName[0]}
                                                </div>
                                                <div className="flex-1 text-left min-w-0">
                                                    <p className="text-sm font-black text-[#2C3E50] truncate mb-0.5">{a.displayName}</p>
                                                    <p className="text-[8px] text-gray-400 font-bold uppercase truncate">{(a as any).agentRole || 'Agent Staff'}</p>
                                                </div>
                                                <ArrowRightLeft size={14} className="text-gray-100 group-hover:text-primary transition-colors" />
                                            </button>
                                        ))}
                                    </div>
                                    <button 
                                        onClick={() => setIsNewDiscussionOpen(true)}
                                        className="px-10 py-4 bg-primary text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all"
                                    >
                                        Parcourir les agents
                                    </button>
                                </div>
                            ) : (
                                recentPrivateAgents.map(a => {
                                    const lastMsg = inboxMessages.find(m => m.participants?.includes(a.uid));
                                    return (
                                        <button 
                                            key={a.uid} 
                                            onClick={() => setSelectedAgent(a)}
                                            className="w-full flex items-center gap-6 p-6 md:p-8 bg-white border border-gray-100 rounded-[2.5rem] md:rounded-[3.5rem] hover:ring-8 hover:ring-primary/5 transition-all group text-left shadow-xl shadow-gray-500/5 relative overflow-hidden"
                                        >
                                            <div className="absolute top-0 right-0 w-2 h-full bg-primary opacity-0 group-hover:opacity-100 transition-all" />
                                            <div className="w-16 h-16 md:w-20 md:h-20 rounded-[1.5rem] md:rounded-[2.5rem] bg-gray-50 flex items-center justify-center text-primary font-black uppercase text-xl md:text-2xl shadow-inner group-hover:bg-primary group-hover:text-white transition-all shrink-0">
                                                {a.displayName[0]}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-black text-[#2C3E50] md:text-lg uppercase tracking-tight group-hover:text-primary transition-colors italic">{a.displayName}</span>
                                                    <span className="text-[9px] md:text-[10px] text-gray-300 font-black tabular-nums border border-gray-50 px-3 py-1 rounded-full">
                                                        {lastMsg?.createdAt?.toDate ? lastMsg.createdAt.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                                    </span>
                                                </div>
                                                <p className="text-xs md:text-sm text-gray-500 font-medium truncate max-w-2xl">
                                                    <span className="opacity-40 italic mr-2 font-bold uppercase text-[9px] tracking-widest">{lastMsg?.senderId === user?.uid ? 'Moi:' : 'Lui:'}</span>
                                                    {lastMsg?.text}
                                                </p>
                                            </div>
                                            <ChevronRight size={24} className="text-gray-100 group-hover:text-primary group-hover:translate-x-2 transition-all shrink-0" />
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    (activeTab === 'public' || selectedAgent) ? (
                    <>
                        <header className="p-6 md:p-8 bg-white border-b border-gray-100 flex items-center justify-between shadow-sm relative z-10 shrink-0">
                            <div className="flex items-center gap-4">
                                {(activeTab === 'private' || activeTab === 'public') && (
                                    <button 
                                        onClick={() => { if(activeTab === 'private') setSelectedAgent(null); else setActiveTab('private'); }} 
                                        className="md:hidden p-2 -ml-2 text-gray-400 hover:text-primary transition-colors"
                                    >
                                        <ChevronRight size={24} className="rotate-180" />
                                    </button>
                                )}
                                <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-primary font-black uppercase shadow-inner text-sm md:text-lg shrink-0">
                                    {activeTab === 'public' ? <Layers size={24} /> : selectedAgent?.displayName[0]}
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-sm md:text-lg font-black text-[#2C3E50] leading-none mb-1 truncate">
                                        {activeTab === 'public' ? "Canal général Staff" : selectedAgent?.displayName}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                                        <span className="text-[8px] md:text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                            {activeTab === 'public' ? "Tous les agents connectés" : "En Ligne"}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <ShieldCheck size={24} className="text-gray-100 hidden sm:block" />
                        </header>

                        <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide flex flex-col scroll-smooth bg-gray-50/50">
                            {displayMessages.map(m => (
                                <div key={m.id} className={cn("flex w-full flex-col", m.senderId === user.uid ? "items-end" : "items-start")}>
                                    {activeTab === 'public' && m.senderId !== user.uid && (
                                        <span className="text-[8px] font-black uppercase tracking-widest text-gray-400 mb-2 ml-4">{m.senderName}</span>
                                    )}
                                    <div className={cn(
                                        "max-w-[85%] md:max-w-[70%] p-6 rounded-[2rem] shadow-sm animate-in slide-in-from-bottom duration-300 relative group transition-all",
                                        m.senderId === user.uid ? "bg-red-50 text-[#2C3E50] border border-red-100 rounded-tr-none" : "bg-gray-100 text-[#2C3E50] border border-gray-200 rounded-tl-none"
                                    )}>
                                        {m.replyTo && (
                                            <div className="mb-4 p-3 bg-white/50 border-l-4 border-primary rounded-lg text-[10px] opacity-60 italic">
                                                <p className="font-black uppercase mb-1">{m.replyTo.senderName}</p>
                                                <p className="truncate">{m.replyTo.text}</p>
                                            </div>
                                        )}
                                        <div className="flex flex-col gap-3">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-black uppercase tracking-widest text-primary shrink-0 bg-primary/5 px-2 py-0.5 rounded-full">
                                                    {(m as any).senderRole || 'Membre Staff'}
                                                </span>
                                                <span className="text-[10px] font-black uppercase tracking-widest text-[#2C3E50] truncate">{m.senderName}</span>
                                            </div>
                                            <p className="text-sm font-medium leading-relaxed">{m.text}</p>
                                        </div>
                                        
                                        <div className="absolute -top-2 -right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                                onClick={() => setReplyTo(m)}
                                                className="p-2 bg-white text-primary border border-gray-100 rounded-full shadow-lg hover:scale-110 transition-transform"
                                                title="Répondre"
                                            >
                                                <ArrowRightLeft size={10} className="rotate-180" />
                                            </button>
                                            {activeTab === 'public' && m.senderId !== user?.uid && (
                                                <button 
                                                    onClick={() => {
                                                        const agent = agents.find(a => a.uid === m.senderId);
                                                        if (agent) {
                                                            setSelectedAgent(agent);
                                                            setActiveTab('private');
                                                        }
                                                    }}
                                                    className="p-2 bg-white text-blue-500 border border-gray-100 rounded-full shadow-lg hover:scale-110 transition-transform"
                                                    title="Message Privé"
                                                >
                                                    <Mail size={10} />
                                                </button>
                                            )}
                                            {(user?.role === 'admin' || m.senderId === user?.uid) && (
                                                <button 
                                                    onClick={() => { setMsgToDelete(m); setIsInternalDeleteConfirmOpen(true); }}
                                                    className="p-2 bg-red-500 text-white rounded-full shadow-lg hover:scale-110 transition-transform"
                                                    title="Supprimer"
                                                >
                                                    <Trash2 size={10} />
                                                </button>
                                            )}
                                        </div>
                                        
                                        {m.attachments?.map((at, idx) => {
                                            const isImg = at.type?.startsWith('image/');
                                            return (
                                                <a 
                                                    key={idx} 
                                                    href={at.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="mt-4 p-4 bg-white border border-gray-100 rounded-2xl flex items-center gap-4 shadow-sm hover:border-primary/30 transition-all group/at"
                                                >
                                                    <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center shrink-0 shadow-inner overflow-hidden border border-gray-100">
                                                        {isImg ? (
                                                            <img src={at.url} className="w-full h-full object-cover" alt="Preview" referrerPolicy="no-referrer" />
                                                        ) : (
                                                            <FileText size={18} className="text-primary" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center justify-between gap-2 overflow-hidden">
                                                            <p className="text-[9px] font-black text-[#2C3E50] truncate">{at.name}</p>
                                                            <Download size={10} className="text-primary opacity-30 group-hover/at:opacity-100 transition-opacity" />
                                                        </div>
                                                        <p className="text-[7px] text-gray-400 font-bold uppercase tracking-widest">{at.type?.split('/')[1]?.toUpperCase() || 'DOCUMENT'}</p>
                                                    </div>
                                                </a>
                                            );
                                        })}
                                        <p className={cn("text-[8px] font-black uppercase tracking-widest mt-4 opacity-30", m.senderId === user.uid ? "text-right" : "text-left")}>
                                            {m.createdAt?.toDate().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <footer className="p-8 bg-white border-t border-gray-100 shrink-0">
                            {replyTo && (
                                <div className="mb-4 p-4 bg-gray-50 border-l-4 border-primary flex items-center justify-between rounded-r-2xl animate-in slide-in-from-top duration-300">
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-black uppercase text-primary mb-1">RÉPONSE À {replyTo.senderName}</p>
                                        <p className="text-xs text-gray-400 truncate italic">"{replyTo.text}"</p>
                                    </div>
                                    <button onClick={() => setReplyTo(null)} className="p-2 text-gray-300 hover:text-red-500">
                                        <X size={16} />
                                    </button>
                                </div>
                            )}
                            {tempAttachments.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-4 animate-in slide-in-from-bottom duration-300">
                                    {tempAttachments.map((f, i) => (
                                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-100 rounded-full text-[10px] font-black uppercase tracking-widest text-[#2C3E50]">
                                            <FileText size={12} className="text-primary" />
                                            <span>{f.name}</span>
                                            <button onClick={() => setTempAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                                                <X size={12} className="text-gray-400 hover:text-red-500" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <form onSubmit={handleSend} className="flex items-end gap-6 bg-gray-50/50 p-2 rounded-[2.5rem] border border-gray-200 shadow-inner focus-within:border-primary/20 transition-all">
                                <label className="p-4 hover:bg-white rounded-full text-gray-400 hover:text-primary transition-all cursor-pointer">
                                    <Paperclip size={24} />
                                    <input type="file" multiple className="hidden" onChange={handleInternalFileChange} />
                                </label>
                                <div className="flex-1 flex flex-col">
                                    {uploading && uploadProgress.some(p => p > 0 && p < 100) && (
                                        <div className="flex gap-2 mb-2 px-2 overflow-x-auto scrollbar-hide">
                                            {uploadProgress.map((p, i) => p > 0 && p < 100 && (
                                                <div key={i} className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-gray-100 shadow-sm animate-pulse">
                                                    <RefreshCw size={10} className="animate-spin text-primary" />
                                                    <span className="text-[8px] font-black">{p}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <textarea 
                                        className="w-full bg-transparent py-4 outline-none text-sm font-medium resize-none max-h-32 min-h-[50px] scrollbar-hide"
                                        placeholder={activeTab === 'public' ? "Canal Staff..." : "Message privé..."}
                                        value={newMsg}
                                        onChange={e => setNewMsg(e.target.value)}
                                        rows={1}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSend();
                                            }
                                        }}
                                    />
                                </div>
                                <button 
                                    type="submit"
                                    disabled={uploading || (!newMsg.trim() && tempAttachments.length === 0)}
                                    className={cn(
                                        "p-4 bg-primary text-white rounded-full shadow-2xl transition-all shrink-0",
                                        (uploading || (!newMsg.trim() && tempAttachments.length === 0)) ? "opacity-30 translate-y-2" : "hover:brightness-110 active:scale-90"
                                    )}
                                >
                                    {uploading ? <RefreshCw size={24} className="animate-spin" /> : <Send size={24} />}
                                </button>
                            </form>
                            
                            <ConfirmModal 
                                isOpen={isInternalDeleteConfirmOpen}
                                onClose={() => setIsInternalDeleteConfirmOpen(false)}
                                onConfirm={deleteInternalMsg}
                                loading={deleting}
                                title="Suppression Dialogue"
                                message="Voulez-vous supprimer ce message ? Les pièces jointes seront également effacées définitivement."
                            />
                        </footer>

                        <Dialog.Root open={isNewDiscussionOpen} onOpenChange={setIsNewDiscussionOpen}>
                            <Dialog.Portal>
                                <Dialog.Overlay className="fixed inset-0 bg-[#2C3E50]/60 backdrop-blur-xl z-[150] animate-in fade-in duration-300" />
                                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-lg bg-white rounded-[3rem] shadow-2xl p-8 z-[160] outline-none animate-in zoom-in-95 duration-500 overflow-hidden font-sans">
                                    <div className="flex items-center justify-between mb-8">
                                        <div>
                                            <Dialog.Title className="text-2xl font-black text-[#2C3E50] uppercase tracking-tighter italic leading-none">Nouvelle Discussion</Dialog.Title>
                                            <Dialog.Description className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-2">Démarrer un échange confidentiel</Dialog.Description>
                                        </div>
                                        <Dialog.Close className="p-3 bg-gray-50 text-gray-400 rounded-full hover:bg-primary/10 hover:text-primary transition-all">
                                            <X size={20} />
                                        </Dialog.Close>
                                    </div>

                                    <div className="relative mb-8">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                                        <input 
                                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-xs font-bold transition-all shadow-inner"
                                            placeholder="Nom ou Email de l'agent..."
                                            value={searchAgent}
                                            onChange={e => setSearchAgent(e.target.value)}
                                        />
                                    </div>

                                    <div className="max-h-80 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
                                        {filteredAgents.length === 0 ? (
                                            <div className="py-20 text-center opacity-20">
                                                <User size={48} className="mx-auto mb-4" />
                                                <p className="font-black uppercase tracking-widest text-xs italic">Aucun agent trouvé</p>
                                            </div>
                                        ) : (
                                            filteredAgents.map(a => (
                                                <button 
                                                    key={a.uid} 
                                                    onClick={() => { setSelectedAgent(a); setIsNewDiscussionOpen(false); }}
                                                    className="w-full flex items-center gap-4 p-4 rounded-3xl hover:bg-primary/5 transition-all group border border-transparent hover:border-primary/10"
                                                >
                                                    <div className="w-12 h-12 bg-gray-100 rounded-[1.25rem] flex items-center justify-center text-primary font-black uppercase shadow-inner group-hover:bg-primary group-hover:text-white transition-all shrink-0">
                                                        {a.displayName[0]}
                                                    </div>
                                                    <div className="flex-1 min-w-0 text-left">
                                                        <p className="text-sm font-black text-[#2C3E50] truncate leading-none mb-1">{a.displayName}</p>
                                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{(a as any).agentRole || 'Agent DGI'}</p>
                                                    </div>
                                                    <div className="p-2 bg-gray-50 text-gray-300 rounded-xl group-hover:bg-primary group-hover:text-white transition-all">
                                                        <ArrowRightLeft size={16} />
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </Dialog.Content>
                            </Dialog.Portal>
                        </Dialog.Root>
                    </>
                  ) : null
                )}
            </div>
        </div>
    );
};

// --- App Structure ---

const AdminGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdminAuthenticated, setAdminAuthenticated, logout } = useAuth();
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  if (user?.role !== 'admin' && user?.role !== 'agent') return <Navigate to="/" />;

  if (!isAdminAuthenticated) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#F4F7F6]">
        <button 
          onClick={() => logout()}
          className="absolute top-8 right-8 p-3 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all z-[110]"
          title="Déconnexion"
        >
          <X size={32} />
        </button>
        <div className="absolute inset-0 opacity-10 mix-blend-multiply pointer-events-none">
            <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--primary)_0%,_transparent_70%)]" />
        </div>
        <div className="bg-white p-10 rounded-[3rem] shadow-2xl max-w-md w-full text-center border border-white relative z-10 animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-primary/10 text-primary rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
            <ShieldCheck size={48} className="animate-pulse" />
          </div>
          <h2 className="text-3xl font-black text-[#2C3E50] mb-3 tracking-tighter uppercase italic">Accès Stratégique</h2>
          <p className="text-gray-400 text-[10px] font-black uppercase tracking-[0.2em] mb-10">Direction Générale des Impôts</p>
          
          <div className="space-y-6">
              <div className="relative">
                <Lock className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                <input 
                  type="password"
                  autoFocus
                  className="w-full pl-16 pr-6 py-6 bg-gray-50 border-2 border-transparent focus:border-primary/20 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 transition-all text-center font-black tracking-[0.6em] text-2xl shadow-inner placeholder:tracking-normal placeholder:font-medium placeholder:text-sm"
                  placeholder="CODE INTERNE"
                  value={pass}
                  onChange={e => setPass(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (isMasterCodeValid(pass) ? setAdminAuthenticated(true) : setError('Accès Refusé'))}
                />
              </div>

              {error && <p className="text-red-600 text-[10px] font-black uppercase tracking-widest animate-bounce">{error}</p>}
              
              <button 
                onClick={() => {
                  if (isMasterCodeValid(pass)) {
                    setAdminAuthenticated(true);
                  } else {
                    setError('Accès Refusé');
                  }
                }}
                className="w-full py-6 bg-primary text-white rounded-2xl font-black text-xs shadow-2xl shadow-primary/30 hover:brightness-110 active:scale-[0.98] transition-all uppercase tracking-[0.3em]"
              >
                Déverrouiller le Portail
              </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const AccountPage = () => {
    const { user } = useAuth();
    const [userData, setUserData] = useState<Partial<AppUser>>(user || {});
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (user && !uploading) setUserData(user);
    }, [user, uploading]);

    const handleSave = async () => {
        if (!user) return;
        setSaving(true);
        try {
            const allowedData = {
                displayName: userData.displayName,
                companyName: userData.companyName,
                taxNumber: userData.taxNumber,
                address: userData.address,
                phone: userData.phone,
                photoURL: userData.photoURL,
                companyPhotoUrl: userData.companyPhotoUrl,
                updatedAt: serverTimestamp(),
                isSetup: true
            };
            await updateDoc(doc(db, 'users', user.uid), allowedData);
            alert("Informations mises à jour avec succès");
        } catch (e: any) {
            alert("Erreur lors de la sauvegarde : " + e.message);
        } finally {
            setSaving(false);
        }
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        if (file.size > 2 * 1024 * 1024) {
            alert("Limite de 2 Mo dépassée. Veuillez choisir une image plus légère.");
            return;
        }
        
        // 1. INSTANT OPTIMISTIC PREVIEW (Local only to avoid Firestore 1MB limit)
        const localUrl = URL.createObjectURL(file);
        setUserData(prev => ({ ...prev, companyPhotoUrl: localUrl, photoURL: localUrl }));
        
        // 2. Background High-Fidelity Compression & Cloud Storage
        setUploading(true);
        try {
            const compressed = await compressImage(file, 512); // Shared DGI profile standard
            const url = await uploadFile(compressed, `profiles/${user.uid}`);
            
            // 3. Permanent URL sync in Firestore
            setUserData(prev => ({ ...prev, companyPhotoUrl: url, photoURL: url }));
            await updateDoc(doc(db, 'users', user.uid), { 
                companyPhotoUrl: url,
                photoURL: url
            });
            
            // Sync auth profile
            const { updateProfile } = await import('firebase/auth');
            await updateProfile(auth.currentUser!, { photoURL: url });
        } catch (e: any) {
            console.error("Profile photo upload failed", e);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-10 max-w-4xl mx-auto font-sans">
            <header className="mb-12">
                <h1 className="text-4xl font-black text-[#2C3E50] tracking-tighter uppercase italic">Mon Compte Contribuable</h1>
                <p className="text-sm text-gray-400 font-bold uppercase tracking-widest mt-1 opacity-60">Gérez vos informations institutionnelles certifiées</p>
            </header>

            <div className="bg-white rounded-[3rem] p-12 border border-gray-100 shadow-2xl space-y-12">
                <div className="flex flex-col md:flex-row gap-12">
                    <div className="shrink-0 flex flex-col items-center">
                        <div className="w-48 h-48 rounded-[2.5rem] bg-gray-50 border-2 border-dashed border-gray-200 overflow-hidden relative group">
                            {userData.companyPhotoUrl ? (
                                <img src={userData.companyPhotoUrl} alt="Logo" className="w-full h-full object-contain p-4" referrerPolicy="no-referrer" />
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                                    <Camera size={48} className="mb-2" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Logo Institutionnel</span>
                                </div>
                            )}
                            <label className="absolute inset-0 cursor-pointer opacity-0 group-hover:opacity-100 bg-primary/20 backdrop-blur-sm transition-opacity flex items-center justify-center z-10">
                                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                                <div className="bg-white p-4 rounded-full text-primary shadow-2xl scale-75 group-hover:scale-100 transition-all duration-300">
                                    <Plus size={28} />
                                </div>
                            </label>
                            {uploading && (
                                <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-20">
                                    <RefreshCw size={32} className="animate-spin text-primary" />
                                </div>
                            )}
                        </div>
                        <div className="mt-4 text-center">
                            <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest leading-relaxed">Certification Visuelle</p>
                            <p className="text-[7px] text-gray-300 font-bold uppercase tracking-[0.2em] mt-1 italic">Optimisation automatique par la DGI</p>
                        </div>
                    </div>

                    <div className="flex-1 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Raison Sociale (Nom Entreprise)</label>
                                <div className="relative">
                                    <Building className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                                    <input 
                                        className="w-full pl-16 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                        value={userData.companyName || ''}
                                        onChange={e => setUserData(p => ({ ...p, companyName: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Numéro d'Impôt (NIU)</label>
                                <div className="relative">
                                    <Hash className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                                    <input 
                                        className="w-full pl-16 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                        value={userData.taxNumber || ''}
                                        onChange={e => setUserData(p => ({ ...p, taxNumber: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Nom du Responsable</label>
                                <div className="relative">
                                    <User className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                                    <input 
                                        className="w-full pl-16 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                        value={userData.displayName || ''}
                                        onChange={e => setUserData(p => ({ ...p, displayName: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Téléphone</label>
                                <div className="relative">
                                    <Phone size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" />
                                    <input 
                                        className="w-full pl-16 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                        value={userData.phone || ''}
                                        onChange={e => setUserData(p => ({ ...p, phone: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] ml-2">Siège Social / Adresse</label>
                            <div className="relative">
                                <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300" size={18} />
                                <input 
                                    className="w-full pl-16 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl outline-none focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-sm font-bold shadow-inner"
                                    value={userData.address || ''}
                                    onChange={e => setUserData(p => ({ ...p, address: e.target.value }))}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between pt-8 border-t border-gray-50">
                    <div className="flex items-center gap-3 text-orange-600">
                        <Info size={16} />
                        <p className="text-[10px] font-black uppercase tracking-widest">Les modifications sont auditées par la DGI</p>
                    </div>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="px-12 py-5 bg-primary text-white rounded-[1.5rem] font-black text-xs uppercase tracking-[0.3em] shadow-2xl shadow-primary/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-30"
                    >
                        {saving ? "Sauvegarde..." : "Enregistrer les Modifications"}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, loading }: any) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-[3rem] w-full max-w-md p-10 shadow-2xl border border-white text-center">
                <div className="w-20 h-20 bg-red-50 text-red-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
                    <AlertTriangle size={40} />
                </div>
                <h3 className="text-2xl font-black text-[#2C3E50] mb-4 uppercase tracking-tighter italic">{title}</h3>
                <p className="text-gray-500 text-xs font-medium mb-10 leading-relaxed px-4">{message}</p>
                <div className="flex gap-4">
                    <button onClick={onClose} className="flex-1 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-primary transition-colors">Annuler</button>
                    <button 
                        onClick={onConfirm} 
                        disabled={loading}
                        className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-red-200 hover:brightness-110 active:scale-95 transition-all disabled:opacity-30"
                    >
                        {loading ? "Suppression..." : "Confirmer"}
                    </button>
                </div>
            </div>
        </div>
    );
};

const FirstLoginModal = ({ user }: { user: AppUser }) => {
    const [code, setCode] = useState('');
    const [confirmCode, setConfirmCode] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSetup = async () => {
        if (!code || code !== confirmCode) {
            alert('Les codes ne correspondent pas.');
            return;
        }
        if (code.length < 4) {
            alert('Le code doit contenir au moins 4 caractères.');
            return;
        }

        setLoading(true);
        try {
            await updateDoc(doc(db, 'users', user.uid), {
                securityCode: code,
                isFirstLogin: false,
                updatedAt: serverTimestamp()
            });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gray-900/80 backdrop-blur-md p-4">
            <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-[2.5rem] w-full max-w-md p-10 md:p-12 shadow-2xl border border-white text-center"
            >
                <div className="w-20 h-20 bg-primary/10 text-primary rounded-3xl flex items-center justify-center mx-auto mb-8">
                    <ShieldLock size={40} />
                </div>
                <h2 className="text-2xl font-black text-[#2C3E50] uppercase tracking-tighter mb-4">Activation du Poste</h2>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-widest leading-relaxed mb-10 opacity-70">
                    Définissez votre code de sécurité interne pour valider les actions sensibles.
                </p>

                <div className="space-y-6">
                    <div className="space-y-2 text-left">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nouveau Code Scellé</label>
                        <input 
                            type="password"
                            autoFocus
                            placeholder="••••••"
                            className="w-full px-6 py-5 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-center text-xl font-black tracking-[0.5em] transition-all"
                            value={code}
                            onChange={e => setCode(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2 text-left">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Confirmation du Code</label>
                        <input 
                            type="password"
                            placeholder="••••••"
                            className="w-full px-6 py-5 bg-gray-50 border border-gray-100 rounded-2xl outline-none focus:ring-4 focus:ring-primary/5 text-center text-xl font-black tracking-[0.5em] transition-all"
                            value={confirmCode}
                            onChange={e => setConfirmCode(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSetup()}
                        />
                    </div>

                    <button 
                        onClick={handleSetup}
                        disabled={loading}
                        className="w-full py-6 bg-primary text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                    >
                        {loading ? <RefreshCw className="animate-spin" size={18} /> : <><ShieldCheck size={18} /> Sceller mon Accès</>}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

const MainContent = () => {
    const { user, loading, isAdminMode } = useAuth();
    
    if (loading) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-bold text-primary uppercase tracking-widest animate-pulse">Chargement Sécurisé...</p>
                </div>
            </div>
        );
    }

    if (!user) return <LoginPage />;

    if (user.role === 'contributor' && !user.isSetup) return <OnboardingPage />;

    return (
        <AppShell>
            <Routes>
                <Route path="/" element={user.role !== 'contributor' && isAdminMode ? <Navigate to="/admin" /> : <DashboardPage />} />
                <Route path="/admin" element={<AdminGuard><DashboardPage /></AdminGuard>} />
                <Route path="/messaging" element={<MessagingPage />} />
                <Route path="/account" element={<AccountPage />} />
                {(user.role === 'admin' || user.role === 'agent') && (
                    <>
                        <Route path="/internal" element={<InternalChatPage />} />
                        <Route path="/directory" element={(hasPermission(user, 'tax_consultation') || hasPermission(user, 'deletion')) ? <DirectoryPage /> : <Navigate to="/" />} />
                    </>
                )}
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </AppShell>
    );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <MainContent />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}
