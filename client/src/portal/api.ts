import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

export function portalToken(): string { return localStorage.getItem('hp_portal_token') || ''; }
export function portalAuthHeader() { return { Authorization: `Bearer ${portalToken()}` }; }

function cfg(extra?: AxiosRequestConfig): AxiosRequestConfig {
  return { ...(extra || {}), headers: { ...(extra?.headers || {}), ...portalAuthHeader() } };
}

export const api   = <T = any>(p: string)            : Promise<AxiosResponse<T>> => axios.get<T>(p, cfg());
export const apost = <T = any>(p: string, d?: any)   : Promise<AxiosResponse<T>> => axios.post<T>(p, d || {}, cfg());
export const aput  = <T = any>(p: string, d?: any)   : Promise<AxiosResponse<T>> => axios.put<T>(p, d || {}, cfg());
export const adel  = <T = any>(p: string, d?: any)   : Promise<AxiosResponse<T>> => axios.delete<T>(p, cfg({ data: d }));

/* ── Shared response shapes used across the portal ─────────────────── */

export interface PortalAccount {
  id: number;
  username: string;
  domain: string;
  status: string;
  expires_at: string | null;
  created_at: string;
  plan_name?: string;
  plan_price?: number;
  disk_quota?: number;
  email_accts?: number;
}

export interface PortalClient {
  id: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  city?: string;
  country?: string;
  created_at: string;
  team_user?: { id: number; permissions: string[]; account_id?: number | null };
}

export interface Invoice {
  id: number;
  invoice_number: string;
  amount: number;
  currency: string;
  status: string;
  due_date: string;
  paid_date: string;
  created_at: string;
  account_domain: string;
  notes: string;
}

export interface DnsRecord       { name: string; type: string; value: string; ttl: string }
export interface EmailAcct       { email: string }
export interface Forwarder       { from: string; to: string }
export interface FtpUser         { username: string; directory: string | null }
export interface DbRow           { name: string }
export interface DbUserRow       { User?: string; user?: string; Host?: string; host?: string }
export interface SslStatus       { issued: boolean; expires?: string | null }
export interface PortalSub       { fqdn: string; parent: string; docroot: string }
export interface PortalRedirect  { id: number; domain: string; source: string; target: string; type: string; created_at: string }
export interface PortalAutoresp  { id: number; email: string; subject: string; body: string; enabled: number }
export interface MailAuth        { domain: string; dkim: string | null; spf: string; dmarc: string }
export interface PortalBackup    { name: string; size: number; created: string }
export interface FileItem        { name: string; type: string; size: number; modified: string; permissions: string }
export interface SshKey          { id: number; raw: string; comment: string }
export interface SshKeyGroup     { user: string; keys: SshKey[] }
export interface CronJob         { id: number; line: string }
export interface CronGroup       { user: string; jobs: CronJob[] }
export interface HtpasswdEntry   { directory: string; users: string[] }
export interface HotlinkConfig   { enabled: boolean; allowed_domains: string[]; blocked_extensions: string }
export interface SpamRule        { id: number; domain: string; type: string; address: string }
export interface SiteStats       { hits: number; bytes: number; top: { hits: number; path: string }[] }
export interface WebmailInfo     { installed: boolean; url: string }
export interface CatchAll        { destination: string | null }
export interface ScanResult      { infected: string[]; infected_count: number }
