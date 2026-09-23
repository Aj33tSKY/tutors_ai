import Link from "next/link";
import { Wordmark } from "@/components/marketing/wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-hairline">
        <div className="shell flex h-16 items-center">
          <Link href="/" aria-label="Kindling — home">
            <Wordmark />
          </Link>
        </div>
      </div>

      <div className="shell flex flex-1 items-center justify-center py-16">{children}</div>
    </div>
  );
}
