import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Contact = {
  id: string;
  fullName: string;
  email: string;
  sessionCount: number;
};

export function ContactsList({ title, singular, contacts }: { title: string; singular: string; contacts: Contact[] }) {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h2 className="display-md">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Direct messages and homework shared with your {singular.toLowerCase()}s.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <div className="rounded-sm border border-dashed border-hairline p-8 text-center">
              <p className="font-medium">No {singular.toLowerCase()}s yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                A conversation becomes available as soon as you share a booked lesson.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-medium">{contact.fullName}</p>
                    <p className="text-sm text-muted-foreground">
                      {contact.email} · {contact.sessionCount} lesson{contact.sessionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/messages/${contact.id}`}>
                      <MessageCircle className="size-3.5" /> Message
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
