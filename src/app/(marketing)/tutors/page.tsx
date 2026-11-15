import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { TutorCatalogueView } from "@/components/tutors/tutors-view";
import { publicTutors } from "../../../../packages/domain/src/tutors";
import { tutorQuery, type TutorQuery } from "../../../../packages/contracts/src/tutors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find a tutor" };

// The unfiltered catalogue is cached; filters apply in memory so each variant reuses one query.
const getCatalogue = unstable_cache(async () => publicTutors(createPublicClient()), ["tutor-catalogue-v2"], { revalidate: 300 });

export default async function TutorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query: TutorQuery = tutorQuery.parse(await searchParams);
  const all = await getCatalogue();
  const tutors = all.tutors.filter((tutor) => (!query.subject || tutor.subjects.includes(query.subject)) && (!query.board || tutor.boards.includes(query.board))
    && (!query.maxPrice || tutor.hourlyRatePence <= query.maxPrice * 100) && (query.day === undefined || tutor.availableDays.includes(query.day)));
  return <TutorCatalogueView catalogue={{ tutors, total: tutors.length, approved: all.approved }} query={query}/>;
}
