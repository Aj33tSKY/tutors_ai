import { LessonRequestsView } from "./lesson-requests-view";
import { declineLessonRequestAction } from "@/app/dashboard/tutor/request-actions";

export function LessonRequests(props: Omit<React.ComponentProps<typeof LessonRequestsView>, "declineAction">) {
  return <LessonRequestsView {...props} declineAction={declineLessonRequestAction}/>;
}
