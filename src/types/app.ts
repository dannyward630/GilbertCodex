import type { HostPlatform } from "../lib/hostPlatform";

export interface AppInfo {
  name: string;
  version: string;
  phase: string;
  runtime: string;
  platform?: HostPlatform;
  arch?: string;
}
