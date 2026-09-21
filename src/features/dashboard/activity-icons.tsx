import {
  FilePlus2,
  MessageCircle,
  PlayCircle,
  Star,
  Upload,
  type LucideIcon,
} from "lucide-react";

/**
 * Icons for an activity row, by kind.
 *
 * Its own module so the Overview and the demo-only activity chunk can each
 * read it without the Overview importing the chunk — which would have
 * defeated the point of making that chunk dynamic.
 */
export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  question: MessageCircle,
  form: FilePlus2,
  upload: Upload,
  video: PlayCircle,
  review: Star,
};
