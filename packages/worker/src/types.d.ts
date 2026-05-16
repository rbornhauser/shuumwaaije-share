import type { CloudflareAccessVariables } from "@hono/cloudflare-access";
import type { Context } from "hono";

export type BasicAuthType = {
	username: string;
	password: string;
	groups?: string[];
};

export type BucketConfig = {
	publicUrl?: string;
};

export type PermissionRule = {
	groups?: string[];
	users?: string[];
	prefixes?: string[];
};

export type BucketPermission = {
	read?: PermissionRule[];
	write?: PermissionRule[];
};

export type R2ExplorerConfig = {
	readonly?: boolean;
	cors?: boolean;
	cfAccessTeamName?: string;
	dashboardUrl?: string;
	emailRouting?:
		| {
			targetBucket: string;
		}
		| false;
	showHiddenFiles?: boolean;
	basicAuth?: BasicAuthType | BasicAuthType[];
	buckets?: Record<string, BucketConfig>;
	bucketPermissions?: Record<string, BucketPermission>;
};

export type ShareMetadata = {
	bucket: string;
	key: string;
	expiresAt?: number;
	passwordHash?: string;
	maxDownloads?: number;
	currentDownloads: number;
	createdBy: string;
	createdAt: number;
};

export type AppEnv = {
	ASSETS: Fetcher;
	[key: string]: R2Bucket;
};
export type AppVariables = {
	config: R2ExplorerConfig;
	authentication_type?: string;
	authentication_username?: string;
} & CloudflareAccessVariables;
export type AppContext = Context<{ Bindings: AppEnv; Variables: AppVariables }>;
