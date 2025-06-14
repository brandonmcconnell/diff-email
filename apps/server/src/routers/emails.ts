import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CreateEmailResponse } from "resend";
import { z } from "zod";
import { db } from "../db";
import { email, run, sentEmail, version } from "../db/schema/core";
import { screenshotsQueue } from "../lib/queue";
import { resend } from "../lib/resend";
import { protectedProcedure, router } from "../lib/trpc";

export const emailsRouter = router({
	list: protectedProcedure
		.input(z.object({ projectId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const rows = await db
				.select()
				.from(email)
				.where(eq(email.projectId, input.projectId));
			return rows;
		}),
	create: protectedProcedure
		.input(
			z.object({
				projectId: z.string().uuid(),
				title: z.string().min(1),
				html: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { projectId, title, html } = input;
			const [row] = await db
				.insert(email)
				.values({ projectId, title })
				.returning();
			// Optionally create initial version if html provided (Phase 3)
			return row;
		}),
	/**
	 * Send a test email using a specific version HTML.
	 */
	sendTest: protectedProcedure
		.input(
			z.object({
				versionId: z.string().uuid(),
				to: z.string().email(),
				subject: z.string().min(1).default("Test email from diff.email"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { versionId, to, subject } = input;

			// Fetch HTML for the version
			const [v] = await db
				.select({ html: version.html })
				.from(version)
				.where(eq(version.id, versionId));
			if (!v) {
				throw new Error("Version not found");
			}

			// Send via Resend
			const res: CreateEmailResponse = await resend.emails.send({
				from: "Diff.email <noreply@diff.email>",
				to,
				subject,
				html: v.html,
			});

			if (!res.data) {
				throw new Error(
					res.error?.message ?? "Failed to send email via Resend",
				);
			}

			const resendId = res.data.id;

			await db.insert(sentEmail).values({
				versionId,
				resendId,
				to,
			});

			return { resendId };
		}),
	/**
	 * Send test email and enqueue screenshot run.
	 */
	sendTestAndRun: protectedProcedure
		.input(
			z.object({
				emailId: z.string().uuid(),
				versionId: z.string().uuid(),
				to: z.string().email(),
				subject: z.string().min(1).default("Test email from diff.email"),
				clients: z
					.array(
						z.object({
							client: z.enum(["gmail", "outlook", "yahoo", "aol", "icloud"]),
							engine: z.enum(["chromium", "firefox", "webkit"]),
						}),
					)
					.default([{ client: "gmail", engine: "chromium" }]),
				dark: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { emailId, versionId, to, subject, clients, dark } = input;

			// Fetch HTML for the version
			const [v] = await db
				.select({ html: version.html })
				.from(version)
				.where(eq(version.id, versionId));
			if (!v) throw new Error("Version not found");

			// Generate a short unique token to later find the email in webmail UIs.
			const subjectToken = randomUUID().slice(0, 8);
			const subjectWithToken = `${subject} [${subjectToken}]`;

			// Send email via Resend with the token appended to subject
			const res: CreateEmailResponse = await resend.emails.send({
				from: "Diff.email <noreply@diff.email>",
				to,
				subject: subjectWithToken,
				html: v.html,
			});

			if (!res.data) {
				throw new Error(
					res.error?.message ?? "Failed to send email via Resend",
				);
			}

			const resendId = res.data.id;

			await db.insert(sentEmail).values({
				versionId,
				resendId,
				to,
			});

			// Insert run row with expected shot count
			const expectedShots = clients.length;
			const [runRow] = await db
				.insert(run)
				.values({ emailId, versionId, expectedShots })
				.returning();

			// Enqueue screenshots with the subjectToken so the worker can search the inbox.
			await Promise.all(
				clients.map((c) =>
					screenshotsQueue.add(
						"screenshot",
						{
							runId: runRow.id,
							html: v.html,
							client: c.client,
							engine: c.engine,
							dark,
							subjectToken,
						},
						{
							attempts: 3,
							backoff: { type: "exponential", delay: 30000 },
							removeOnComplete: true,
							removeOnFail: false,
						},
					),
				),
			);

			return { runId: runRow.id, resendId };
		}),
});
