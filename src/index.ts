import * as fs from "fs"
import { BlockList } from "net"
import { exit } from "process"
import { Agent, BodyInit, fetch, HeadersInit, Response } from "undici"
import { FileTargetResponse, StatusResponse, StatusWithPeers, WaitingFile, WhoIsResponse } from "./types.js"
import { toCamelCaseKeys } from "./util.js"

export interface TailscaleLocalApiOptions {
  socketPath?: string
  useSocketOnly?: boolean
}

export class TailscaleLocalApi {
  private fetch: (path: string, options?: {
    method: string
    headers: HeadersInit
    body: BodyInit
  }) => Promise<Response>
  private baseUrl = "http://local-tailscaled.sock"
  private readonly tailscaleCidr = new BlockList()
  readonly socketPath: string
  readonly capabilitiesNamespace: string | undefined
  private adapterPort: number | undefined
  private adapterPassword: string | undefined
  private maxRetries = 5
  private retryDelay = 5000
  readonly environment: "windows" | "macos" | "unix" | "container"
  private useSocketOnly: boolean

  constructor(options?: TailscaleLocalApiOptions) {
    this.useSocketOnly = options?.useSocketOnly ?? false
    this.environment = this.interrogateEnvironment()
    this.socketPath =
      options?.socketPath ?? (this.environment === "container" ? "/tmp/tailscaled.sock" : "/var/run/tailscaled.socket")

    this.tailscaleCidr.addSubnet("100.64.0.0", 10, "ipv4")
    this.tailscaleCidr.addSubnet("fd7a:115c:a1e0::", 48, "ipv6")

    console.log(
      `Initializing Tailscale communication with ${this.environment === "macos" && !this.useSocketOnly ? "localhost TCP" : "Unix socket"}`
    )
    console.log(`Detected environment: ${this.environment}`)

    if (this.environment === "macos") {
      this.getCredentialsFromSameuserProof()
    }

    this.fetch = this.createFetchFn()

    this.connectWithRetry(0)
  }

  private connectWithRetry(retryCount: number): void {
    this.fetch("/localapi/v0/status")
      .then((resp) => {
        if (resp.ok) {
          console.log("Tailscale is running")
        } else {
          throw new Error(`Tailscale API returned status ${resp.status}`)
        }
      })
      .catch((e) => {
        console.error(
          `Failed to connect to Tailscale with ${
            this.environment === "macos" ? "localhost TCP" : "Unix socket"
          }, is it running?`
        )
        console.error(`Error: ${e.message}`)

        if (retryCount < this.maxRetries) {
          const nextRetry = retryCount + 1
          const delay = this.retryDelay * Math.pow(1.5, retryCount) // Exponential backoff

          console.log(`Retrying in ${delay / 1000} seconds... (Attempt ${nextRetry}/${this.maxRetries})`)

          setTimeout(() => {
            this.connectWithRetry(nextRetry)
          }, delay)
        } else {
          console.error(`Failed to connect to Tailscale after ${this.maxRetries} attempts, exiting.`)
          exit(1)
        }
      })
  }

  private createFetchFn() {
    if (this.useSocketOnly || this.environment !== "macos") {
      const dispatcher = new Agent({
        connect: {
          socketPath: this.socketPath,
        },
      })
      return (path: string, {
        method,
        headers,
        body,
      }: {
        method: string
        headers: HeadersInit
        body: BodyInit
      } = {
        method: "GET",
        headers: {},
        body: null,
      }) => {
        return fetch(this.baseUrl + path, { dispatcher, method, headers, body }).catch((e) => {
          console.error("Failed to fetch", e)
          throw e
        })
      }
    }

    this.baseUrl = `http://127.0.0.1:${this.adapterPort}`
    return (path: string,{
      method,
      headers,
      body,
    }: {
      method: string
      headers: HeadersInit
      body: BodyInit
    } = {
      method: "GET",
      headers: {},
      body: null,
    }) => {
      return fetch(this.baseUrl + path, {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${this.adapterPassword}`).toString("base64")}`,
          Host: "local-tailscaled.sock",
          ...headers,

        },
        body,
        method,
      }).catch((err) => {
        console.error("Failed to fetch", err)
        throw err
      })
    }
  }
  /**
   * 
   * @returns the localhost TCP port number and auth token
    from a sameuserproof file written to /Library/Tailscale.
    
    In that case the files are:

	  /Library/Tailscale/ipnport => $port (symlink with localhost port number target)
	  /Library/Tailscale/sameuserproof-$port is a file containing only the auth token as a hex string.
   */
  private getCredentialsFromSameuserProof(): [number, string] {
    const SHARED_DIR = "/Library/Tailscale"
    const IPN_PORT_FILE = "ipnport"

    try {
      const portStr = fs.readlinkSync(`${SHARED_DIR}/${IPN_PORT_FILE}`)
      const port = parseInt(portStr, 10)
      if (isNaN(port)) {
        throw new Error(`Invalid port number: ${portStr}`)
      }

      // Read the auth token from the sameuserproof file
      const authBytes = fs.readFileSync(`${SHARED_DIR}/sameuserproof-${portStr}`, "utf8")
      const auth = authBytes.trim()

      if (!auth) {
        throw new Error("Empty auth token in sameuserproof file")
      }
      // Store the credentials in instance variables
      this.adapterPort = port
      this.adapterPassword = auth

      return [port, auth]
    } catch (err) {
      throw new Error(`Failed to read credentials: ${err instanceof Error ? err.message : ""}`)
    }
  }

  private interrogateEnvironment(): "windows" | "macos" | "unix" | "container" {
    const platform = process.platform

    // Check if running in a container
    if (this.isRunningInContainer()) {
      return "container"
    }

    if (platform === "win32") {
      // Todo: figure out how windows works...
      return "windows"
    }

    if (platform === "darwin") {
      return "macos"
    }

    return "unix"
  }

  private isRunningInContainer(): boolean {
    try {
      // Check for Docker
      if (fs.existsSync("/.dockerenv")) {
        return true
      }

      // Check for Kubernetes
      if (process.env["KUBERNETES_SERVICE_HOST"]) {
        return true
      }

      // Check cgroup for container evidence (Linux)
      if (process.platform === "linux") {
        try {
          const cgroupContent = fs.readFileSync("/proc/1/cgroup", "utf8")
          if (cgroupContent.includes("docker") || cgroupContent.includes("kubepods") || cgroupContent.includes("lxc")) {
            return true
          }
        } catch {
          // Ignore errors reading cgroup file
        }
      }

      return false
    } catch {
      return false
    }
  }

  isInTailscaleIpRange(ip: string): string | false {
    // Handle IPv4-mapped IPv6 addresses (::ffff:a.b.c.d)
    const match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
    if (match && match[1]) {
      // Extract the IPv4 part and check it
      return this.tailscaleCidr.check(match[1]) && match[1]
    }

    return this.tailscaleCidr.check(ip) && ip
  }

 

  async whoIs(ip: string): Promise<WhoIsResponse> {
    const resp = await this.fetch(`/localapi/v0/whois?addr=${ip}`)
    if (!resp.ok) {
      const res = await resp.text()
      throw new Error("Couldn't get whois for " + ip, { cause: res })
    }
    const body = await resp.json()
    const camelCaseBody = toCamelCaseKeys(body)
    return camelCaseBody as WhoIsResponse
  }

  async prefs(): Promise<unknown> {
    const resp = await this.fetch("/localapi/v0/prefs")
    if (!resp.ok) {
      const res = await resp.text()
      throw new Error("Couldn't get prefs", { cause: res })
    }
    const body = await resp.json()
    const camelCaseBody = toCamelCaseKeys(body)
    return camelCaseBody as unknown
  } 

  /**
   * Returns a dump of the Tailscale daemon's current goroutines.
   * @returns Promise resolving to the goroutines dump
   */
  async goroutines() {
    const resp = await this.fetch("/localapi/v0/goroutines")
    if (!resp.ok) {
      const res = await resp.text()
      throw new Error("Couldn't get goroutines", { cause: res })
    }
    
    // Get the response as an ArrayBuffer
    const goroutines = await resp.text()
    return goroutines
  }
  
  /**
   * Returns the Tailscale daemon's metrics in the Prometheus text exposition format.
   * @returns Promise resolving to the metrics data
   */
  async daemonMetrics(): Promise<string> {
    const resp = await this.fetch("/localapi/v0/metrics")
    if (!resp.ok) {
      const res = await resp.text()
      throw new Error("Couldn't get daemon metrics", { cause: res })
    }
    return await resp.text()
  }

  /**
   * Returns the user metrics in the Prometheus text exposition format.
   * @returns Promise resolving to the user metrics data
   */
  async userMetrics(): Promise<string> {
    const resp = await this.fetch("/localapi/v0/usermetrics")
    if (!resp.ok) {
      const res = await resp.text()
      throw new Error("Couldn't get user metrics", { cause: res })
    }
    return await resp.text()
  }

  /**
   * Increments the value of a Tailscale daemon's counter metric by the given delta.
   * If the metric doesn't exist yet, a new counter metric is created and initialized to delta.
   * 
   * Does not support gauge metrics or negative delta values.
   * 
   * @param name The name of the counter to increment
   * @param delta The amount to increment by (must be non-negative)
   * @returns Promise that resolves when the counter has been incremented
   */
  async incrementCounter(name: string, delta: number): Promise<void> {
    interface MetricUpdate {
      name: string;
      type: string;
      value: number;
    }

    if (delta < 0) {
      throw new Error("negative delta not allowed");
    }

    const updates: MetricUpdate[] = [{
      name: name,
      type: "counter",
      value: delta,
    }];

    const resp = await fetch(`${this.baseUrl}/localapi/v0/upload-client-metrics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to increment counter: ${errorText}`);
    }
  }

  /**
   * Returns the Tailscale daemon's status.
   * @returns Promise resolving to the status information with peers
   */
  async status(): Promise<StatusWithPeers> {
    return this.getStatus(true) as unknown as StatusWithPeers;
  }

  /**
   * Returns the Tailscale daemon's status, without the peer info.
   * @returns Promise resolving to the status information without peers
   */
  async statusWithoutPeers(): Promise<StatusResponse> {
    return this.getStatus(false);
  }

  /**
   * Internal method to get status with optional query parameters
   * @param includePeers Whether to include peers in the response
   * @returns Promise resolving to the status information
   */
  private async getStatus(includePeers?: boolean): Promise<StatusResponse | StatusWithPeers> {
    const resp = await this.fetch(`/localapi/v0/status${includePeers ? "" : "?peers=false"}`);
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get status: ${errorText}`);
    }
    
    const data = await resp.json();
    const result = toCamelCaseKeys(data);
    
    return result as StatusResponse | StatusWithPeers;
  }

  /**
   * Returns the list of received Taildrop files that have been received by the Tailscale daemon
   * in its staging/cache directory but not yet transferred by the user's CLI or GUI client
   * and written to a user's home directory somewhere.
   * 
   * @returns Promise resolving to the list of waiting files
   */
  async waitingFiles(): Promise<WaitingFile[]> {
    return this.awaitWaitingFiles(0);
  }

  /**
   * Like waitingFiles but takes a duration to await for an answer.
   * If the duration is 0, it will return immediately. The duration is respected at second
   * granularity only. If no files are available, it returns an empty array.
   * 
   * @param seconds Number of seconds to wait for files
   * @returns Promise resolving to the list of waiting files
   */
  async awaitWaitingFiles(seconds: number): Promise<WaitingFile[]> {
    const path = `/localapi/v0/files/?waitsec=${Math.floor(seconds)}`;
    const resp = await this.fetch(path);
    
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get waiting files: ${errorText}`);
    }
    
    const data = await resp.json();
    return toCamelCaseKeys(data) as WaitingFile[];
  }

  /**
   * Deletes a waiting file from the Tailscale daemon's staging directory.
   * 
   * @param baseName The base name of the file to delete
   * @returns Promise that resolves when the file has been deleted
   */
  async deleteWaitingFile(baseName: string): Promise<void> {
    const encodedName = encodeURIComponent(baseName);
    const resp = await this.fetch(`/localapi/v0/files/${encodedName}`, {
      method: "DELETE",
      headers: {},
      body: null,
    });
    
    if (resp.status !== 204) {
      const errorText = await resp.text();
      throw new Error(`Failed to delete waiting file: ${errorText}`);
    }
  }

  /**
   * Gets a waiting file from the Tailscale daemon's staging directory.
   * 
   * @param baseName The base name of the file to get
   * @returns Promise resolving to an object containing the file data and size
   */
  async getWaitingFile(baseName: string): Promise<{ data: ArrayBuffer; size: number }> {
    const encodedName = encodeURIComponent(baseName);
    const resp = await fetch(`${this.baseUrl}/localapi/v0/files/${encodedName}`);
    
    if (resp.status !== 200) {
      const errorText = await resp.text();
      throw new Error(`Failed to get waiting file: ${errorText}`);
    }
    
    if (resp.headers.get('transfer-encoding') === 'chunked') {
      throw new Error("Unexpected chunking");
    }
    
    const size = Number(resp.headers.get('content-length') || 0);
    const data = await resp.arrayBuffer();
    
    return { data, size };
  }

  /**
   * Gets the list of file targets (devices that can receive files).
   * 
   * @returns Promise resolving to the list of file targets
   */
  async fileTargets(): Promise<FileTargetResponse> {
    const resp = await this.fetch("/localapi/v0/file-targets");
    
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Failed to get file targets: ${errorText}`);
    }
    
    const data = await resp.json();
    return toCamelCaseKeys(data) as FileTargetResponse;
  }

  /**
   * Sends a Taildrop file to a target device.
   * 
   * @param targetNodeId The stable node ID of the target device
   * @param filePath Path to the file to send
   * @returns Promise that resolves when the file has been sent
   */
  async pushFile(targetNodeId: string, filePath: string): Promise<void>;

  /**
   * Sends a Taildrop file to a target device.
   * 
   * @param options Options for sending the file
   * @returns Promise that resolves when the file has been sent
   */
  async pushFile(options: {
    targetNodeId: string;
    size: number;
    name: string;
    data: ArrayBuffer | ReadableStream<Uint8Array>;
  }): Promise<void>;

  /**
   * Implementation of pushFile that handles both overloads
   */
  async pushFile(
    targetNodeIdOrOptions: string | {
      targetNodeId: string;
      size: number;
      name: string;
      data: ArrayBuffer | ReadableStream<Uint8Array>;
    },
    maybeFilePath?: string
  ): Promise<void> {
    // Handle the file path overload
    if (typeof targetNodeIdOrOptions === 'string' && maybeFilePath) {
      const targetNodeId = targetNodeIdOrOptions;
      const filePath = maybeFilePath;
      
      // Get file stats to determine size
      const stats = fs.statSync(filePath);
      const size = stats.size;
      
      // Extract the filename from the path
      const name = filePath.split(/[\\/]/).pop() || 'file';
      
      // Read the file into a buffer instead of using a stream
      const data = fs.readFileSync(filePath);
      
      // Call the implementation with the extracted details
      return this.pushFile({
        targetNodeId,
        size,
        name,
        data,
      });
    }
    
    // Rest of the implementation remains the same
    const options = targetNodeIdOrOptions as {
      targetNodeId: string;
      size: number;
      name: string;
      data: ArrayBuffer | ReadableStream<Uint8Array>;
    };
    
    const { targetNodeId, size, name, data } = options;
    const encodedName = encodeURIComponent(name);
    const url = `/localapi/v0/file-put/${targetNodeId}/${encodedName}`;
    
    const headers: HeadersInit = {};
    if (size !== -1) {
      headers['Content-Length'] = size.toString();
    }
    console.log("got fucked here?")
    const resp = await this.fetch(url, {
      method: 'PUT',
      headers,
      body: data,
    });
    
    if (resp.status !== 200) {
      const errorText = await resp.text();
      throw new Error(`Failed to push file: ${resp.status} ${errorText}`);
    }
    // Drain the response body to ensure the request is complete
    await resp.arrayBuffer();
  }

  /**
   * Starts the Tailscale client with the specified options.
   * 
   * @param options The options to start Tailscale with
   * @returns Promise that resolves when Tailscale has been started
   */
  async start(options?: Record<string, any>): Promise<void> {
    const resp = await this.fetch("/localapi/v0/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: options ? JSON.stringify(options) : null,
    });
    
    if (resp.status !== 204) {
      const errorText = await resp.text();
      throw new Error(`Failed to start Tailscale: ${errorText}`);
    }
  }

  /**
   * Logs out the current Tailscale node.
   * 
   * @returns Promise that resolves when the node has been logged out
   */
  async logout(): Promise<void> {
    const resp = await this.fetch("/localapi/v0/logout", {
      method: "POST",
      headers: {},
      body: null,
    });
    
    if (resp.status !== 204) {
      const errorText = await resp.text();
      throw new Error(`Failed to logout: ${errorText}`);
    }
  }

  /**
   * Starts an interactive login process for Tailscale.
   * 
   * @returns Promise that resolves when the login process has been initiated
   */
  async startLoginInteractive(): Promise<void> {
    const resp = await this.fetch("/localapi/v0/login-interactive", {
      method: "POST",
      headers: {},
      body: null,
    });
    
    if (resp.status !== 204) {
      const errorText = await resp.text();
      throw new Error(`Failed to start interactive login: ${errorText}`);
    }
  }
}
