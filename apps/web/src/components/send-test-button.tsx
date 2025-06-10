"use client";
import { Button } from "@/components/ui/button";
import { trpc } from "@/utils/trpc";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
	versionId: string;
	defaultSubject?: string;
};

export function SendTestButton({ versionId, defaultSubject }: Props) {
	const sendTestMutation = useMutation(trpc.emails.sendTest.mutationOptions());

	async function handleClick() {
		const to = window.prompt("Send test email to:");
		if (!to) return;
		const subject = window.prompt("Subject:", defaultSubject ?? "Test email");
		toast.promise(
			async () => {
				await sendTestMutation.mutateAsync({
					versionId,
					to,
					subject: subject ?? undefined,
				});
			},
			{
				loading: "Sending…",
				success: "Test email sent!",
				error: (err) => err.message,
			},
		);
	}

	return (
		<Button onClick={handleClick} disabled={sendTestMutation.isPending}>
			{sendTestMutation.isPending ? (
				<Loader2 className="animate-spin" size={16} />
			) : (
				"Send test"
			)}
		</Button>
	);
}
