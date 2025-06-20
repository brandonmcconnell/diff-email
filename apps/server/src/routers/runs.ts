import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "../db";
import { run, screenshot, version } from "../db/schema/core";
import { screenshotsQueue } from "../lib/queue";
import { protectedProcedure, router } from "../lib/trpc";

export const runsRouter = router({
	create: protectedProcedure
		.input(
			z.object({
				emailId: z.string().uuid(),
				versionId: z.string().uuid(),
				// clients array & dark flag for future; accept but ignore for now
				clients: z.array(
					z.object({
						client: z.enum(["gmail", "outlook", "yahoo", "aol", "icloud"]),
						engine: z.enum(["chromium", "firefox", "webkit"]),
					}),
				),
				dark: z.boolean(),
				subjectToken: z.string().optional(),
				messageId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { emailId, versionId, clients, dark, subjectToken, messageId } =
				input;
			// fetch HTML for the version to embed in job data
			const [versionRow] = await db
				.select()
				.from(version)
				.where(eq(version.id, versionId));
			if (!versionRow) {
				throw new Error("Version not found");
			}
			const expectedShots = clients.length;
			const [row] = await db
				.insert(run)
				.values({ emailId, versionId, expectedShots })
				.returning();

			if (!row) {
				throw new Error("Failed to insert run row");
			}
			// Enqueue a job per client/engine pair
			await Promise.all(
				clients.map((c) =>
					screenshotsQueue.add(
						"screenshot",
						{
							runId: row.id,
							html: versionRow.html,
							client: c.client,
							engine: c.engine,
							dark,
							subjectToken,
							messageId,
						},
						{
							attempts: 3,
							backoff: {
								type: "exponential",
								delay: 30_000, // 30 s initial delay
							},
							removeOnComplete: true,
							removeOnFail: false,
						},
					),
				),
			);
			return row;
		}),

	get: protectedProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			// fetch run and its screenshots
			const [runRow] = await db
				.select()
				.from(run)
				.where(eq(run.id, input.runId));
			const shots = await db
				.select()
				.from(screenshot)
				.where(eq(screenshot.runId, input.runId));
			return { ...runRow, screenshots: shots };
		}),

	list: protectedProcedure
		.input(z.object({ emailId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const rows = await db
				.select()
				.from(run)
				.where(eq(run.emailId, input.emailId))
				.orderBy(desc(run.createdAt));
			return rows;
		}),
});
