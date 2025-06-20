import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { getGravatarUrl } from "@/lib/gravatar";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

export default function UserMenu() {
	const router = useRouter();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-9 w-24" />;
	}

	if (!session) {
		return (
			<Button variant="outline" asChild>
				<Link href="/login">Get Started</Link>
			</Button>
		);
	}

	// Build absolute URL for placeholder (required by Gravatar)
	const placeholderUrl =
		typeof window !== "undefined"
			? `${window.location.origin}/avatar-placeholder.svg`
			: "/avatar-placeholder.svg"; // SSR fallback (will be rewritten on client)
	const avatarUrl = getGravatarUrl(session.user.email, 128, placeholderUrl);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					className="flex items-center gap-2.5 py-0 pr-2.5 pl-0.5"
				>
					<img
						src={avatarUrl}
						alt={session.user.name ?? "avatar"}
						className="size-7.5 rounded-sm border border-border object-cover"
						onError={(e) => {
							e.currentTarget.onerror = null;
							e.currentTarget.src = "/avatar-placeholder.svg";
							e.currentTarget.classList.remove("border");
						}}
					/>
					<span>{session.user.name}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuLabel>My Account</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link href="/settings">Account Settings</Link>
				</DropdownMenuItem>
				<DropdownMenuItem
					variant="destructive"
					onSelect={() => {
						authClient.signOut({
							fetchOptions: {
								onSuccess: () => {
									router.push("/");
								},
							},
						});
					}}
				>
					Sign Out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
