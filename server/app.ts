import Fastify, { LogController, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import { Store } from "./db.js";
import { SyncService } from "./sync.js";
import { equalToken, randomToken, verifyPassword } from "./security.js";
import type { Config } from "./config.js";
import type { Downloader } from "./fetch-source.js";
import type { Role, SessionInfo } from "../shared/types.js";
class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
const kindSchema = z.enum(["busy", "detailed"]);
const sourceSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  username: z.string().max(256).optional(),
  password: z.string().max(1024).optional(),
  keepPassword: z.boolean().optional(),
});
const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(256);
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time in HH:mm format.");
const settingsSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid IANA time zone."),
    weekStart: z.number().int().min(0).max(6),
    workStart: timeSchema,
    workEnd: timeSchema,
    refreshMinutes: z.number().int().min(1).max(1440),
  })
  .refine(
    (value) => value.workStart < value.workEnd,
    "Working hours must end after they start.",
  );
const rangeSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    q: z.string().max(256).default(""),
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid display time zone.")
      .optional(),
    filter: z.enum(["all", "busy", "free", "tentative"]).default("all"),
    preview: z.enum(["true", "false"]).default("false"),
  })
  .refine((value) => {
    const duration = Date.parse(value.end) - Date.parse(value.start);
    return duration > 0 && duration <= 400 * 86400_000;
  }, "Choose a date range of up to 400 days.");
export async function createApp(
  config: Config,
  options: {
    downloader?: Downloader;
    sync?: boolean;
    staticRoot?: string;
    store?: Store;
  } = {},
) {
  const app = Fastify({
    logger: config.log
      ? {
          level: "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.body",
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 32_768,
    trustProxy: false,
  });
  const store = options.store || new Store(config);
  await store.initialize();
  const sync = new SyncService(store, options.downloader);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.secureCookies ? [] : null,
      },
    },
    referrerPolicy: { policy: "same-origin" },
    hsts: config.secureCookies,
  });
  await app.register(rateLimit, { global: false });
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.secureCookies,
  };
  const getSession = (request: FastifyRequest) =>
    request.cookies.wc_session
      ? store.session(request.cookies.wc_session)
      : undefined;
  const role = (request: FastifyRequest): Role =>
    getSession(request)?.role || "public";
  const owner = (request: FastifyRequest) => {
    if (role(request) !== "owner")
      throw new ApiError(403, "Owner sign-in is required.");
  };
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    reply.header("cache-control", "no-store");
    reply.header("vary", "Cookie");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const expectedOrigin =
        config.origin || `${request.protocol}://${request.host}`;
      if (request.headers.origin && request.headers.origin !== expectedOrigin)
        throw new ApiError(
          403,
          "This request must come from the calendar website.",
        );
      const session = getSession(request);
      const expected = session?.csrf || request.cookies.wc_csrf;
      const provided = request.headers["x-csrf-token"];
      if (
        !expected ||
        typeof provided !== "string" ||
        !equalToken(provided, expected)
      )
        throw new ApiError(403, "Refresh the page before trying again.");
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({ error: error.issues[0]?.message || "Check the form fields." });
    if (error instanceof ApiError)
      return reply.code(error.statusCode).send({ error: error.message });
    const statusCode =
      error && typeof error === "object" && "statusCode" in error
        ? Number(error.statusCode)
        : 500;
    if (statusCode === 429)
      return reply
        .code(429)
        .send({ error: "Too many attempts. Please wait before trying again." });
    if (statusCode >= 400 && statusCode < 500)
      return reply.code(statusCode).send({
        error:
          "The request could not be accepted. Check the input and try again.",
      });
    // Error objects from fetch libraries can contain source URLs or credentials.
    app.log.error(
      { name: error instanceof Error ? error.name : "Error" },
      "Calendar request failed",
    );
    return reply
      .code(500)
      .send({ error: "The request could not be completed. Please try again." });
  });
  app.get("/healthz", async (_req, reply) => {
    try {
      store.db.prepare("SELECT 1").get();
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });
  app.get("/api/session", async (request, reply): Promise<SessionInfo> => {
    const session = getSession(request);
    let csrf = session?.csrf || request.cookies.wc_csrf;
    if (!csrf) {
      csrf = randomToken();
      reply.setCookie("wc_csrf", csrf, cookieOptions);
    }
    if (!session && request.cookies.wc_session)
      reply.clearCookie("wc_session", cookieOptions);
    return {
      role: session?.role || "public",
      expiresAt: session ? new Date(session.expires).toISOString() : null,
      csrfToken: csrf,
      viewerEnabled: Boolean(store.password("viewer")),
      settings: store.settings(),
    };
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const body = z
        .object({
          role: z.enum(["viewer", "owner"]),
          password: z.string().min(1).max(256),
          rememberMe: z.boolean().default(false),
        })
        .parse(request.body);
      if (!(await verifyPassword(body.password, store.password(body.role))))
        throw new ApiError(401, "The password is incorrect.");
      if (request.cookies.wc_session)
        store.deleteSession(request.cookies.wc_session);
      const rememberMe = body.role === "viewer" && body.rememberMe;
      const session = store.createSession(body.role, rememberMe);
      reply.setCookie("wc_session", session.token, {
        ...cookieOptions,
        ...(body.role === "owner" || rememberMe
          ? { expires: new Date(session.expires) }
          : {}),
      });
      return {
        role: body.role,
        csrfToken: session.csrf,
        expiresAt: new Date(session.expires).toISOString(),
      };
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    if (request.cookies.wc_session)
      store.deleteSession(request.cookies.wc_session);
    reply.clearCookie("wc_session", cookieOptions);
    return { message: "Calendar locked." };
  });
  async function calendarRequest(request: FastifyRequest) {
    const range = rangeSchema.parse(request.query);
    try {
      return await sync.events(
        new Date(range.start),
        new Date(range.end),
        role(request),
        range.preview === "true" && role(request) === "owner",
        range.q,
        range.filter,
        range.timeZone,
      );
    } catch {
      throw new ApiError(
        422,
        "This calendar range could not be expanded. Choose a shorter date range or ask the owner to check the source.",
      );
    }
  }
  app.get("/api/calendar/events", calendarRequest);
  app.get("/api/calendar/events/:id", async (request) => {
    const id = z.object({ id: z.string().max(100) }).parse(request.params).id;
    const result = await calendarRequest(request);
    const event = result.events.find((event) => event.id === id);
    if (!event)
      throw new ApiError(
        404,
        "This event is unavailable in the selected date range.",
      );
    return { event };
  });
  app.get("/api/owner/settings", async (request) => {
    owner(request);
    return {
      settings: store.settings(),
      sources: [sync.info("busy"), sync.info("detailed")],
      viewerEnabled: Boolean(store.password("viewer")),
    };
  });
  app.put("/api/owner/settings", async (request) => {
    owner(request);
    store.saveSettings(settingsSchema.parse(request.body));
    return { settings: store.settings(), message: "Calendar settings saved." };
  });
  for (const action of ["test", "save"] as const) {
    app.post(`/api/owner/sources/:kind/${action}`, async (request) => {
      owner(request);
      const kind = kindSchema.parse((request.params as { kind: string }).kind);
      const input = sourceSchema.parse(request.body);
      try {
        return action === "test"
          ? await sync.test(kind, input)
          : await sync.replace(kind, input);
      } catch (error) {
        const message =
          error instanceof Error &&
          /^(The |Private-network |HTTP Basic |An HTTPS |Use an |Enter )/.test(
            error.message,
          )
            ? error.message
            : "The source could not be reached. Check its URL and credentials, then try again.";
        throw new ApiError(400, message);
      }
    });
  }
  app.post("/api/owner/sources/:kind/refresh", async (request) => {
    owner(request);
    const kind = kindSchema.parse((request.params as { kind: string }).kind);
    await sync.refresh(kind);
    return sync.info(kind);
  });
  app.delete("/api/owner/sources/:kind", async (request) => {
    owner(request);
    const kind = kindSchema.parse((request.params as { kind: string }).kind);
    await sync.remove(kind);
    return { message: "Source and cached events removed." };
  });
  app.put("/api/owner/passwords/:role", async (request, reply) => {
    owner(request);
    const target = z
      .enum(["viewer", "owner"])
      .parse((request.params as { role: string }).role);
    const body = z
      .object({
        password:
          target === "owner"
            ? passwordSchema
            : z.string().min(1, "Enter a visitor password.").max(256),
        currentPassword: z.string().max(256).optional(),
      })
      .parse(request.body);
    if (
      target === "owner" &&
      !(await verifyPassword(
        body.currentPassword || "",
        store.password("owner"),
      ))
    )
      throw new ApiError(401, "Your current owner password is incorrect.");
    await store.setPassword(target, body.password);
    if (target === "owner") reply.clearCookie("wc_session", cookieOptions);
    return {
      message:
        target === "owner"
          ? "Owner password changed. Sign in again."
          : "Viewer password changed. Previous viewer sessions have been revoked.",
    };
  });
  app.delete("/api/owner/passwords/viewer", async (request) => {
    owner(request);
    store.removeViewerPassword();
    return {
      message: "Detailed viewing disabled. Viewer sessions have been revoked.",
    };
  });
  const staticRoot = options.staticRoot || resolve("dist/client");
  if (existsSync(resolve(staticRoot, "index.html"))) {
    await app.register(staticFiles, {
      root: staticRoot,
      wildcard: false,
      cacheControl: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.includes("."))
        return reply.code(404).send({ error: "Not found." });
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    });
  }
  app.addHook("onClose", async () => {
    await sync.stop();
    store.close();
  });
  if (options.sync !== false) sync.start();
  return { app, store, sync };
}
