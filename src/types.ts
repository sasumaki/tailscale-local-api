/**
 * Response type for WhoIs API requests
 */
export type WhoIsResponse = {
  node: {
    id: number;
    stableID: string;
    name: string;
    user: number;
    key: string;
    keyExpiry: string;
    machine: string;
    discoKey: string;
    addresses: string[];
    allowedIPs: string[];
    endpoints: string[];
    homeDERP: number;
    hostinfo: {
      os: string;
      hostname: string;
      services: Array<{
        proto: string;
        port: number;
      }>;
    };
    created: string;
    machineAuthorized?: boolean;
    capabilities: string[];
    capMap?: Record<string, Array<unknown>>
    online: boolean;
    computedName: string;
    computedNameWithHost: string;
  };
  userProfile: {
    id: number;
    loginName: string;
    displayName: string;
    profilePicURL: string;
    roles: string[];
  };
  capMap: {
    [capability: string]: Array<{
      routes: Array<{
        route: string;
        methods: string[];
      }>;
    }>;
  };
}

/**
 * Represents a peer in the Tailscale network
 */
export interface Peer {
  id: string;
  publicKey: string;
  hostName: string;
  dNSName: string;
  os: string;
  userID: number;
  tailscaleIPs: string[];
  allowedIPs: string[];
  addrs: string[] | null;
  curAddr: string;
  relay: string;
  rxBytes: number;
  txBytes: number;
  created: string;
  lastWrite: string;
  lastSeen: string;
  lastHandshake: string;
  online: boolean;
  exitNode: boolean;
  exitNodeOption: boolean;
  active: boolean;
  peerAPIURL?: string[];
  capabilities?: string[];
  capMap?: Record<string, any>;
  inNetworkMap: boolean;
  inMagicSock: boolean;
  inEngine: boolean;
  keyExpiry: string;
  user?: {
    id: number;
    loginName: string;
    displayName: string;
    profilePicURL: string;
    roles: string[];
  };
  clientVersion?: { runningLatest: boolean };
}

/**
 * Response type for Status API requests
 */
export interface StatusResponse {
  version: string;
  tun: boolean;
  backendState: string;
  haveNodeKey: boolean;
  authURL: string;
  tailscaleIPs: string[];
  self: Peer;
  health: any[];
  magicDNSSuffix: string;
  currentTailnet: {
    name: string;
    magicDNSSuffix: string;
    magicDNSEnabled: boolean;
  };
  certDomains: string[];
}

/**
 * Status response with peers included
 */
export interface StatusWithPeers extends StatusResponse {
  peer: Record<string, Peer>;
}

/**
 * Represents a Tailscale node
 */
export interface Node {
  id: number;
  stableID: string;
  name: string;
  user: number;
  key: string;
  keyExpiry: string;
  machine: string;
  discoKey: string;
  addresses: string[];
  allowedIPs: string[];
  homeDERP: number;
  hostinfo: {
    os: string;
    hostname: string;
    services?: Array<{
      proto: string;
      port: number;
    }>;
  };
  created: string;
  lastSeen: string;
  online: boolean;
  computedName: string;
  computedNameWithHost: string;
  machineAuthorized?: boolean;
  capabilities?: string[];
  capMap?: Record<string, Array<unknown>>;
}

/**
 * Represents a file target (device that can receive files)
 */
export interface FileTarget {
  node: Node;
  peerAPIURL: string;
}

/**
 * Response type for file targets API
 */
export type FileTargetResponse = FileTarget[];

/**
 * Represents a file waiting to be transferred from the Tailscale daemon
 */
export interface WaitingFile {
  name: string;
  size: number;
  partialPath: string;
  createTime: string;
  sender: {
    id: string;
    displayName: string;
  };
}

