import { Contact, LEGAL, LegalDocument, List, P, type LegalSection } from "@/components/marketing/legal-document";

const SECTIONS: LegalSection[] = [
  { id: "who", title: "Who we are", body: <>
    <P>{LEGAL.company} (“{LEGAL.product}”, “we”, “us”) runs {LEGAL.product}, an online service that connects A-Level students with tutors for live lessons. We are the controller of the personal data described here: we decide why and how it is used.</P>
    <P>Questions about this policy or your data: <Contact/>.</P></> },
  { id: "collect", title: "What we collect", body: <>
    <P>Only what the service needs to work:</P>
    <List items={[
      <><strong>Account details:</strong> your name, email address, whether you are a student or a tutor, and either a password (stored only as a hash by our sign-in provider) or your Google account identifier if you sign in with Google.</>,
      <><strong>Tutor profile:</strong> subjects and exam boards taught, hourly rate, availability, and the identity and safeguarding evidence our team reviews before approving a profile.</>,
      <><strong>Lessons:</strong> lesson requests and bookings, times, lesson names, and messages between you and your tutor or student.</>,
      <><strong>Lesson recordings and notes:</strong> when a tutor starts a recorded lesson, the audio of the lesson and any screen the tutor shares. Cameras are never recorded. From the audio we create a written transcript and a summary of the lesson.</>,
      <><strong>Revision assistant:</strong> the questions you ask the revision assistant and its answers, which draw on your own lesson notes.</>,
      <><strong>Payments:</strong> we do not store card numbers. Our payment provider holds them; we keep a reference to your customer record, the card brand and last four digits, and the status of invoices. To take a payment for a lesson, your name, email and saved payment method are shared with your tutor’s own Stripe account, which is how the tutor is paid.</>,
      <><strong>Technical data:</strong> sign-in sessions, your IP address and device information in security and server logs, used to keep the service running and secure.</>,
    ]}/></> },
  { id: "why", title: "Why we use it", body: <>
    <List items={[
      <><strong>To provide the service you asked for</strong> (contract): creating your account, matching you with tutors, running lessons, taking and settling payments, and keeping your lesson notes.</>,
      <><strong>With your consent:</strong> recording a lesson. The tutor must confirm everyone has agreed before recording starts. You can decline, and the lesson can go ahead unrecorded.</>,
      <><strong>To keep the service safe and working</strong> (legitimate interests): preventing abuse, fixing faults, and reviewing tutors before they appear in search.</>,
      <><strong>To meet legal obligations</strong>, for example tax and safeguarding duties.</>,
    ]}/></> },
  { id: "who-else", title: "Who we share it with", body: <>
    <P>We use a small number of providers to run the service. They process data only on our instructions:</P>
    <List items={[
      <><strong>Supabase</strong>, for our database and sign-in. Our database is hosted in Ireland.</>,
      <><strong>Cloudflare</strong>, to host the website and API, and to store lesson recordings.</>,
      <><strong>Our own video server</strong>, hosted in Germany, which carries the live lesson using the open-source LiveKit software.</>,
      <><strong>Deepgram</strong>, which turns lesson audio into a transcript.</>,
      <><strong>OpenAI</strong>, which writes lesson summaries and powers the revision assistant.</>,
      <><strong>Stripe</strong>, which takes payments and pays tutors.</>,
      <><strong>Google</strong>, if you choose to sign in with Google.</>,
      <>An <strong>email delivery provider</strong>, which sends confirmation and password-reset emails.</>,
    ]}/>
    <P>Within {LEGAL.product}, your tutor or student, and the administrators who run the service, can see the lesson information relevant to them. Other users cannot see your messages, recordings, transcripts or revision chats. We do not sell personal data and do not use it for advertising.</P></> },
  { id: "abroad", title: "Transfers outside the UK", body: <>
    <P>Some providers above, such as Deepgram, OpenAI, Stripe and Google, may process data outside the UK. Where they do, we rely on the safeguards UK data protection law requires for international transfers.</P></> },
  { id: "keep", title: "How long we keep it", body: <>
    <List items={[
      <><strong>Lesson recordings</strong> (audio and screen shares) are deleted automatically 90 days after the lesson.</>,
      <><strong>Transcripts, summaries and lesson notes</strong> are kept so you can revisit past lessons, until you ask us to delete them or close your account.</>,
      <><strong>Account and booking records</strong> are kept while your account is open, and for as long afterwards as the law requires us to keep financial records.</>,
      <><strong>Security logs</strong> are kept for a short period for troubleshooting and abuse prevention.</>,
    ]}/></> },
  { id: "young", title: "Young people", body: <>
    <P>{LEGAL.product} is aimed at A-Level students, who are usually 16 to 18. You must be at least 13 to have an account. We apply the same protections to everyone and keep young people’s lesson recordings, transcripts and chats visible only to the people involved in them and to our administrators.</P></> },
  { id: "rights", title: "Your rights", body: <>
    <P>You can ask us to access, correct or delete your personal data, to restrict or stop how we use it, or to give you a copy you can take elsewhere. Where we rely on your consent, you can withdraw it at any time. To use any of these rights, contact us at <Contact/>.</P>
    <P>If you are unhappy with how we have handled your data, you can complain to the Information Commissioner’s Office at ico.org.uk.</P></> },
  { id: "cookies", title: "Cookies and similar technologies", body: <>
    <P>We use only what is strictly necessary: secure cookies that keep you signed in, and a setting in your browser that remembers your light or dark theme and whether your menu is collapsed. We do not use advertising or analytics cookies, so there is nothing to opt out of.</P></> },
  { id: "changes", title: "Changes to this policy", body: <>
    <P>If we change how we use personal data we will update this page and the date at the top, and tell you in the service if the change is significant.</P></> },
];

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return <LegalDocument title="Privacy policy" sections={SECTIONS}
    intro={<>This policy explains what personal data {LEGAL.product} collects, why, who sees it, and your choices. It is written to be read, not skimmed past.</>}/>;
}
