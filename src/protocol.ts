export type Method = 'run' | 'stop' | 'ping';

export interface ClientMessage {
  method: Method;
  params: {
    args: string[];
    cwd: string;
    raw?: boolean;
    json?: boolean;
  };
}

export interface PageMeta {
  url: string;
  title: string;
}

export interface SerializedResponse {
  page?: PageMeta;
  snapshot?: string;
  code?: string[];
  result?: string;
  error?: string;
}

export interface ServerMessage {
  ok: boolean;
  text?: string;
  raw?: string;
  json?: SerializedResponse;
  error?: string;
  code?: 'ELEMENT_NOT_FOUND' | 'DAEMON_DEAD' | 'VERSION_MISMATCH' | 'DRIVER_ERROR' | 'TIMEOUT';
}
