export type UserRole = 'admin' | 'agent' | 'contributor';
export type AgentPermission = 'branding' | 'agent_management' | 'deletion' | 'tax_consultation' | 'read' | 'write' | 'validate' | 'admin_view';

export interface AppUser {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  photoURL?: string;
  companyName?: string;
  taxNumber?: string;
  logoUrl?: string;
  address?: string;
  managerName?: string;
  companyPhotoUrl?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  isFirstLogin?: boolean;
  securityCode?: string;
  assignedAgentId?: string; // For contributors: who manages them
  assignedAgentName?: string; 
  matricule?: string;
  isSetup: boolean;
  isActive: boolean;
  isNew?: boolean;
  isSuperContribuable?: boolean;
  assignedContribuables?: string[];
  internalPassword?: string;
  lastLogin: any;
  updatedAt?: any;
  invitedBy?: string;
  tempPassword?: string;
  permissions?: AgentPermission[];
  status?: 'active' | 'suspended' | 'archived' | 'deleted_trash';
  deletedAt?: any;
  restrictGedAdmin?: boolean;
  gedPasscode?: string;
}

export interface GedItem {
  id: string;
  name: string;
  type: 'folder' | 'file';
  parentId: string | null;
  space: 'private' | 'administrative' | 'contributor';
  ownerId: string;
  ownerEmail?: string;
  contributorId?: string;
  extension?: string;
  fileUrl?: string;
  fileSize?: number;
  isDeleted: boolean;
  deletedAt?: any;
  isLocked?: boolean;
  lockPasscode?: string;
  createdBy: {
    uid: string;
    displayName: string;
    firstName: string;
    lastName: string;
    matricule: string;
  };
  createdAt: any;
  updatedAt?: any;
}

export interface Invitation {
  id: string;
  email: string;
  role: 'admin' | 'agent';
  permissions: AgentPermission[];
  status: 'pending' | 'accepted';
  invitedBy: string;
  invitedByName: string;
  createdAt: any;
}

export interface Attachment {
  url: string;
  name: string;
  type?: string;
  size?: number;
  createdAt?: string;
}

export interface Conversation {
  id: string;
  participants: string[];
  contributorId: string;
  agentId?: string;
  assignedAgentId?: string; // Linked to the taxpayer's manager
  assignedAgentName?: string;
  subject: string;
  lastUpdate: any;
  lastMessagePreview: string;
  isReadByContributor: boolean;
  isReadByDGI: boolean;
  status: 'open' | 'closed' | 'archived';
  companyName?: string;
  contributorName?: string;
  taxNumber?: string;
}

export interface Exchange {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  body: string;
  attachments?: Attachment[];
  createdAt: any;
  status?: 'sent' | 'delivered' | 'read';
  participants: string[];
  conversationId: string;
  deletedForUser?: boolean;
  deletedForAdmin?: boolean;
  isInternal?: boolean; // New flag for internal notes
}

export interface InternalMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  channel: 'public' | 'private';
  participants?: string[];
  threadId?: string;
  text: string; // Standardized from 'content' to 'text' to match App.tsx
  attachments?: Attachment[];
  attachmentUrl?: string; // Legacy support
  attachmentName?: string; // Legacy support
  createdAt: any;
  replyTo?: {
    id: string;
    text: string;
    senderName: string;
  } | null;
}

export interface ThemeConfig {
  primary: string;
  secondary: string;
  font: string;
  logoUrl: string;
  faviconUrl: string;
  borderRadius: number;
  cardShadow: 'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  componentPadding: 'compact' | 'normal' | 'relaxed';
  appName: string;
  appTitle: string;
  welcomeMessage: string;
  supportEmail: string;
  footerText: string;
  updatedAt?: number;
}

export const DEFAULT_THEME: ThemeConfig = {
  primary: '#0F172A',
  secondary: '#F8FAFC',
  font: 'Inter, sans-serif',
  logoUrl: 'https://cdn-icons-png.flaticon.com/512/2830/2830305.png', // Government building icon as default
  faviconUrl: 'https://cdn-icons-png.flaticon.com/512/2830/2830305.png',
  borderRadius: 24,
  cardShadow: 'xl',
  componentPadding: 'normal',
  appName: 'Portail DGI',
  appTitle: 'Direction Générale des Impôts',
  welcomeMessage: 'Bienvenue sur votre portail fiscal sécurisé.',
  supportEmail: 'support@dgi.gouv',
  footerText: '© 2026 Direction Générale des Impôts. Tous droits réservés.'
};
