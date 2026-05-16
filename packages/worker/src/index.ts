import { cloudflareAccess } from "@hono/cloudflare-access";
import {
	type OpenAPIObjectConfigV31,
	extendZodWithOpenApi,
	fromHono,
} from "chanfana";
import { type ExecutionContext, Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { cors } from "hono/cors";
import { z } from "zod";
import { readOnlyMiddleware } from "./foundation/middlewares/readonly";
import { settings } from "./foundation/settings";
import { CopyObject } from "./modules/buckets/copyObject";
import { CreateFolder } from "./modules/buckets/createFolder";
import { CreateShareLink } from "./modules/buckets/createShareLink";
import { DeleteObject } from "./modules/buckets/deleteObject";
import { DeleteShareLink } from "./modules/buckets/deleteShareLink";
import { GetObject } from "./modules/buckets/getObject";
import { GetShareLink } from "./modules/buckets/getShareLink";
import { HeadObject } from "./modules/buckets/headObject";
import { ListObjects } from "./modules/buckets/listObjects";
import { ListShares } from "./modules/buckets/listShares";
import { MoveObject } from "./modules/buckets/moveObject";
import { CompleteUpload } from "./modules/buckets/multipart/completeUpload";
import { CreateUpload } from "./modules/buckets/multipart/createUpload";
import { PartUpload } from "./modules/buckets/multipart/partUpload";
import { PutMetadata } from "./modules/buckets/putMetadata";
import { PutObject } from "./modules/buckets/putObject";
import { dashboardIndex, dashboardRedirect } from "./modules/dashboard";
import { receiveEmail } from "./modules/emails/receiveEmail";
import { SendEmail } from "./modules/emails/sendEmail";
import { GetInfo } from "./modules/server/getInfo";
import type {
	AppContext,
	AppEnv,
	AppVariables,
	BasicAuthType,
	BucketPermission,
	R2ExplorerConfig,
} from "./types";

type PermissionAction = "read" | "write";

function decodeR2Base64Key(value?: string) {
	if (!value) return "";
	try {
		return decodeURIComponent(escape(atob(value)));
	} catch {
		return value;
	}
}

function getUserGroups(c: AppContext) {
	const basicAuth = c.get("config").basicAuth;
	if (!basicAuth) return [];

	const users = Array.isArray(basicAuth) ? basicAuth : [basicAuth];
	const username = c.get("authentication_username");
	return users.find((user) => user.username === username)?.groups ?? [];
}

function matchesPermissionRule(
	rule: { groups?: string[]; users?: string[]; prefixes?: string[] },
	username: string | undefined,
	groups: string[],
	path: string,
) {
	const isUserMatch = username && rule.users?.includes(username);
	const isGroupMatch = groups.some((group) => rule.groups?.includes(group));
	if (!isUserMatch && !isGroupMatch) return false;

	if (!rule.prefixes || rule.prefixes.length === 0) return true;
	if (path === "") {
		return rule.prefixes.some((prefix) => prefix === "" || prefix === "/");
	}
	return rule.prefixes.some((prefix) => path === prefix || path.startsWith(prefix));
}

async function getRequestedPath(c: AppContext) {
	const bucketKey = c.req.param("key");
	if (bucketKey) return decodeR2Base64Key(bucketKey);

	const url = new URL(c.req.url);
	const prefix = url.searchParams.get("prefix");
	if (prefix) return decodeR2Base64Key(prefix);

	const queryKey = url.searchParams.get("key");
	if (queryKey) return decodeR2Base64Key(queryKey);

	const contentType = c.req.header("content-type")?.split(";")[0];
	if (contentType === "application/json") {
		const body = await c.req.json().catch(() => null);
		if (body) {
			return (
				decodeR2Base64Key(body.key) ||
				decodeR2Base64Key(body.oldKey) ||
				decodeR2Base64Key(body.sourceKey) ||
				decodeR2Base64Key(body.destinationKey) ||
				""
			);
		}
	}

	return "";
}

async function isBucketAllowed(
	c: AppContext,
	bucketName: string,
	action: PermissionAction,
) {
	const bucketPermissions = c.get("config").bucketPermissions;
	if (!bucketPermissions) return true;

	const bucketRule = bucketPermissions[bucketName] as BucketPermission | undefined;
	if (!bucketRule) return false;

	const rules = bucketRule[action];
	if (!rules || rules.length === 0) return false;

	const username = c.get("authentication_username");
	const groups = getUserGroups(c);
	const path = await getRequestedPath(c);

	return rules.some((rule) => matchesPermissionRule(rule, username, groups, path));
}

export function R2Explorer(config?: R2ExplorerConfig) {
	extendZodWithOpenApi(z);
	config = config || {};
	if (config.readonly !== false) config.readonly = true;

	const openapiSchema: OpenAPIObjectConfigV31 = {
		openapi: "3.1.0",
		info: {
			title: "R2 Explorer API",
			version: settings.version,
		},
	};

	if (config.basicAuth) {
		openapiSchema["security"] = [
			{
				basicAuth: [],
			},
		];
	}

	const app = new Hono<{ Bindings: AppEnv; Variables: AppVariables }>();
	app.use("*", async (c, next) => {
		c.set("config", config);
		await next();
	});

	const openapi = fromHono(app, {
		schema: openapiSchema,
		raiseUnknownParameters: true,
		generateOperationIds: false,
	});

	if (config.cors === true) {
		app.use("/api/*", cors());
	}

	if (config.readonly === true) {
		app.use("/api/*", readOnlyMiddleware);
	}

	const cloudflareAccessMiddleware = config.cfAccessTeamName
		? cloudflareAccess(config.cfAccessTeamName)
		: undefined;

	const basicAuthMiddleware = config.basicAuth
		? basicAuth({
			invalidUserMessage: "Authentication error: Basic Auth required",
			verifyUser: (username, password, c: AppContext) => {
				const users = (
					Array.isArray(c.get("config").basicAuth)
						? c.get("config").basicAuth
						: [c.get("config").basicAuth]
				) as BasicAuthType[];

				for (const user of users) {
					if (user.username === username && user.password === password) {
						c.set("authentication_type", "basic-auth");
						c.set("authentication_username", username);
						return true;
					}
				}

				return false;
			},
		})
		: undefined;

	if (config.cfAccessTeamName || config.basicAuth) {
		if (config.basicAuth) {
			openapi.registry.registerComponent("securitySchemes", "basicAuth", {
				type: "http",
				scheme: "basic",
			});
		}

		app.use("*", async (c, next) => {
			if (c.req.path.startsWith("/share")) {
				return next();
			}

			if (cloudflareAccessMiddleware) {
				await cloudflareAccessMiddleware(c, async () => {
					c.set("authentication_type", "cloudflare-access");
					c.set("authentication_username", c.get("accessPayload").email);
					await next();
				});
				return;
			}

			if (basicAuthMiddleware) {
				return basicAuthMiddleware(c, next);
			}

			await next();
		});
	}

	const bucketAccessMiddleware = async (c: AppContext, next: () => Promise<void>) => {
		const bucketName = c.req.param("bucket");
		if (!bucketName) {
			return next();
		}

		const action: PermissionAction =
			c.req.method === "GET" || c.req.method === "HEAD" ? "read" : "write";

		if (!(await isBucketAllowed(c, bucketName, action))) {
			return c.text("Forbidden", { status: 403 });
		}

		return next();
	};

	app.use("/api/buckets/:bucket", bucketAccessMiddleware);
	app.use("/api/buckets/:bucket/*", bucketAccessMiddleware);

	openapi.get("/api/server/config", GetInfo);

	openapi.get("/api/buckets/:bucket", ListObjects);
	openapi.post("/api/buckets/:bucket/move", MoveObject);
	openapi.post("/api/buckets/:bucket/copy", CopyObject);
	openapi.post("/api/buckets/:bucket/folder", CreateFolder);
	openapi.post("/api/buckets/:bucket/upload", PutObject);
	openapi.post("/api/buckets/:bucket/multipart/create", CreateUpload);
	openapi.post("/api/buckets/:bucket/multipart/upload", PartUpload);
	openapi.post("/api/buckets/:bucket/multipart/complete", CompleteUpload);
	openapi.post("/api/buckets/:bucket/delete", DeleteObject);
	openapi.on("head", "/api/buckets/:bucket/:key", HeadObject);
	openapi.get("/api/buckets/:bucket/:key/head", HeadObject); // There are some issues with calling the head method

	// Share link routes
	openapi.post("/api/buckets/:bucket/:key/share", CreateShareLink);
	openapi.get("/api/buckets/:bucket/shares", ListShares);
	openapi.delete("/api/buckets/:bucket/share/:shareId", DeleteShareLink);

	// These object routes should be defined last
	openapi.get("/api/buckets/:bucket/:key", GetObject);
	openapi.post("/api/buckets/:bucket/:key", PutMetadata);

	openapi.post("/api/emails/send", SendEmail);

	// Public share access (no authentication required)
	openapi.get("/share/:shareId", GetShareLink);

	openapi.get("/", dashboardIndex);
	openapi.get("*", dashboardRedirect);

	app.all("*", () =>
		Response.json({ msg: "404, not found!" }, { status: 404 }),
	);

	return {
		// TODO: improve event type
		async email(
			event: { raw: unknown; rawSize: unknown },
			env: AppEnv,
			context: ExecutionContext,
		) {
			await receiveEmail(event, env, context, config);
		},
		async fetch(request: Request, env: unknown, context: ExecutionContext) {
			return app.fetch(request, env as AppEnv, context);
		},
	};
}
