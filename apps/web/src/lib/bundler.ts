// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – esbuild-wasm provides same API as esbuild but no TS types
import * as esbuild from "esbuild-wasm";

/**
 * In-memory bundler for the playground. Accepts a map of file paths → contents
 * and returns bundled JS (ESM) for the given entry file.
 *
 * The caller must ensure that `esbuild.initialize()` is called exactly once per
 * tab. We lazily initialise the WASM on first call and reuse it afterwards.
 */
// Keep flags on globalThis so that hot-reload doesn't double-initialize esbuild
// biome-ignore lint/suspicious/noExplicitAny: TODO: improve `globalThis` type
const g = globalThis as any;
if (!g.__esbuildReady) {
	g.__esbuildReady = {
		initialized: false,
		promise: null as Promise<void> | null,
	};
}
let initialized = g.__esbuildReady.initialized as boolean;
let initPromise: Promise<void> | null = g.__esbuildReady.promise;

export async function bundle(
	entry: string,
	files: Record<string, string>,
): Promise<string> {
	if (!initialized) {
		if (!initPromise) {
			initPromise = esbuild
				.initialize({
					wasmURL:
						"https://unpkg.com/esbuild-wasm@0.25.5/esbuild.wasm" /* fallback CDN and version-aligned */,
					worker: false, // run on main thread – fine for small playground bundles
				})
				.then(() => {
					initialized = true;
					g.__esbuildReady.initialized = true;
				});
		}
		await initPromise;
	}

	const inMemPlugin: esbuild.Plugin = {
		name: "in-memory-files",
		setup(build: esbuild.PluginBuild) {
			// jsx-runtime shim
			build.onResolve({ filter: /^react$/ }, () => ({
				path: "https://esm.sh/react@19",
				external: true,
			}));

			build.onResolve({ filter: /^react-dom$/ }, () => ({
				path: "https://esm.sh/react-dom@19",
				external: true,
			}));

			build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
				path: "https://esm.sh/react@19/jsx-runtime",
				external: true,
			}));

			// Handle @react-email packages
			build.onResolve({ filter: /^@react-email\// }, (args) => ({
				path: `https://esm.sh/${args.path}`,
				external: true,
			}));

			// Resolve relative imports to other in-memory files
			build.onResolve(
				{ filter: /.*/ },
				(args: esbuild.OnResolveArgs): esbuild.OnResolveResult => {
					const { path, importer, resolveDir } = args;

					// Handle react imports specially
					if (path === "react" || path === "react/jsx-runtime") {
						return { path, external: true };
					}

					// entry file (no importer) – leave as is
					if (!importer) {
						return { path, namespace: "mem", pluginData: { dir: "/" } };
					}
					// Bare identifier
					if (!path.startsWith("./") && !path.startsWith("../")) {
						// Check if virtual file exists with common extensions
						const cand = [".tsx", ".ts", ".jsx", ".js"].map(
							(ext) => `${path}${ext}`,
						);
						const found = cand.find((f) => files[f] !== undefined);
						if (found) {
							return { path: found, namespace: "mem" };
						}
						// Treat as external npm package fetched from esm.sh
						return {
							path: `https://esm.sh/${path}`,
							external: true,
						};
					}
					// Resolve relative path within our virtual FS
					const baseDir = resolveDir || "/";
					const normalized = new URL(path, `file://${baseDir}/`).pathname.slice(
						1,
					);
					return { path: normalized, namespace: "mem" };
				},
			);

			// Load file contents
			build.onLoad(
				{ filter: /.*/, namespace: "mem" },
				({ path }: esbuild.OnLoadArgs): esbuild.OnLoadResult | null => {
					const contents = files[path];
					if (contents == null) return null; // let esbuild error propagate

					// Pick loader based on extension so TS/JSX work
					const ext = path.split(".").pop()?.toLowerCase();
					const loader =
						ext === "ts"
							? "ts"
							: ext === "tsx"
								? "tsx"
								: ext === "jsx"
									? "jsx"
									: "js"; // default
					return {
						contents,
						loader: loader as esbuild.Loader,
						resolveDir: "/",
					};
				},
			);
		},
	};

	try {
		const result = await esbuild.build({
			entryPoints: [entry],
			bundle: true,
			write: false,
			format: "esm",
			target: "es2020", // Add explicit target for better compatibility
			sourcemap: false, // Disable source maps entirely
			plugins: [inMemPlugin],
			jsx: "automatic",
			minify: false,
			banner: {
				js: "", // Explicitly disable banner
			},
			legalComments: "none", // Remove all legal comments
			logLevel: "error", // Only show errors
		});

		let output = result.outputFiles[0].text;

		// Clean up the output to ensure it's valid for <script> injection
		// Remove UTF-8 BOM and other invisible characters one by one
		output = output.replace(/^\uFEFF/, ""); // BOM
		output = output.replace(/^[\u200B\u200C\u2028\u2029]+/, ""); // Other invisible chars
		// Remove zero-width joiner separately since it can create sequences
		output = output.replace(/^\u200D+/, "");

		// Only remove block comments (/* ... */), not single-line comments
		// Single-line comment removal is dangerous because it can break URLs in strings
		output = output.replace(/\/\*[\s\S]*?\*\//g, "");

		// Remove source map comments specifically (these are safe to remove)
		output = output.replace(/\/\/[#@]\s*sourceMappingURL[^\n]*/g, "");

		// Final trim to remove any leading/trailing whitespace
		output = output.trim();

		// Ensure output starts with valid JavaScript
		if (!output || output.length === 0) {
			throw new Error("Bundle produced empty output");
		}

		// Prepend process.env polyfill to handle templates that reference it at module scope
		const processPolyfill = `// Process.env polyfill for React Email templates
if (typeof process === 'undefined') {
	var process = { env: { VERCEL_URL: 'example.vercel.app', NODE_ENV: 'development' } };
}
`;

		return processPolyfill + output;
	} catch (_error: unknown) {
		const error = _error as Error & { errors: esbuild.PartialMessage[] };
		// Format esbuild's error array into a readable message
		if ("errors" in error) {
			const formatted = await esbuild.formatMessages(error.errors, {
				kind: "error",
				color: false,
			});
			throw new Error(formatted.join("\n"));
		}
		throw error;
	}
}
