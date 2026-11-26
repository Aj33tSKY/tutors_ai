import Link from "next/link";
import { Contact, LEGAL, LegalDocument, List, P, type LegalSection } from "@/components/marketing/legal-document";

const SECTIONS: LegalSection[] = [
  { id: "service", title: "The service", body: <>
    <P>{LEGAL.product} is an online platform run by {LEGAL.company}. It lets students find and book live lessons with tutors, and gives them lesson notes and a revision assistant based on their own lessons. By creating an account or using the service you agree to these terms and acknowledge our <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link>.</P>
    <P>Tutors on {LEGAL.product} are independent. They are not employees or agents of {LEGAL.company}. We provide the platform; each lesson is between the student and the tutor.</P></> },
  { id: "accounts", title: "Accounts", body: <>
    <List items={[
      "You must be at least 13 to have an account. If you are under 18, please make sure a parent or guardian knows you are using the service.",
      "Give accurate information and keep your sign-in details to yourself. You are responsible for what happens under your account.",
      "You choose whether you are a student or a tutor when you sign up. This cannot be changed afterwards.",
      "One person, one account.",
    ]}/></> },
  { id: "tutors", title: "Tutors", body: <>
    <P>A tutor’s profile appears in search only after our team has approved it, which includes reviewing their identity and safeguarding evidence. Approval is not a guarantee of any outcome and does not make the tutor our employee. Tutors set their own hourly rates and availability, must be honest about their qualifications, and must follow the lesson rules below.</P></> },
  { id: "lessons", title: "Booking and lessons", body: <>
    <List items={[
      "Prices are set by tutors and shown before you request a lesson. Your first lesson with each tutor is free.",
      "A tutor confirms the time you request. Lessons take place in your browser.",
      "Be on time, be respectful, and use lesson time for learning.",
      "Do not share sign-in details, record lessons yourself, or share lesson content outside the platform without everyone’s agreement.",
    ]}/></> },
  { id: "recording", title: "Recording and notes", body: <>
    <P>A tutor may record a lesson’s audio and any screen they share, but only after confirming that everyone present has agreed. Cameras are never recorded. Recordings are deleted automatically after 90 days. We create a transcript and a summary from the audio, which stay available to the student and tutor involved. Details are in the <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link>.</P></> },
  { id: "payments", title: "Payments", body: <>
    <P>After your free first lesson with a tutor, completed lessons are invoiced and paid through our payment provider, Stripe. By saving a payment method you authorise charges for lessons you have had. Tutors receive their earnings through Stripe and must complete Stripe’s checks to be paid. We do not store card numbers.</P></> },
  { id: "ai", title: "The revision assistant", body: <>
    <P>The revision assistant uses artificial intelligence and works from your own lesson notes. It can be wrong or incomplete. Check important facts against your tutor, your exam board’s specification, or your textbook. It is a study aid, not a substitute for a tutor or for official guidance.</P></> },
  { id: "conduct", title: "Acceptable use", body: <>
    <P>You must not:</P>
    <List items={[
      "harass, abuse or discriminate against anyone, or behave in a way that puts a young person at risk;",
      "arrange lessons or payments off the platform to avoid these terms;",
      "upload anything unlawful, or that infringes someone else’s rights;",
      "interfere with, probe or overload the service, or try to access other people’s data.",
    ]}/>
    <P>We may suspend or remove accounts that break these rules, and we may report serious concerns, including safeguarding concerns, to the appropriate authorities.</P></> },
  { id: "ip", title: "Content and ownership", body: <>
    <P>You keep ownership of what you create and upload. You give {LEGAL.company} the limited permission needed to store, process and display it to provide the service to you and the people you are in lessons with. We and our licensors own the platform itself.</P></> },
  { id: "liability", title: "Our responsibility", body: <>
    <P>We take reasonable care to provide the service, but we cannot promise it will always be available or error-free, or that any lesson will lead to a particular exam result. Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, fraud, or your rights as a consumer. Subject to that, we are not liable for losses that were not a foreseeable result of our breach, or for business losses, and our total liability for any claim is limited to the amount you paid through the service in the previous 12 months.</P></> },
  { id: "ending", title: "Ending your account", body: <>
    <P>You can stop using {LEGAL.product} at any time and ask us to close your account at <Contact/>. We may suspend or end access if you break these terms or if the law requires it. Anything you already owe remains payable.</P></> },
  { id: "changes", title: "Changes and governing law", body: <>
    <P>We may update these terms. If a change is significant we will tell you in the service before it applies, and continuing to use {LEGAL.product} afterwards means you accept it. These terms are governed by the law of England and Wales, and the courts of England and Wales can decide disputes, although consumers keep any right to bring a claim where they live.</P>
    <P>Questions about these terms: <Contact/>.</P></> },
];

export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return <LegalDocument title="Terms of service" sections={SECTIONS}
    intro={<>These are the rules for using {LEGAL.product}. They are meant to be fair and plain: please read them before you create an account.</>}/>;
}
