// Copied from the Leadership Hub (src/components/assistant/icons.tsx); keep in step with it.
import type { ComponentProps } from "react";

/** One consistent stroke icon set (24px grid, 1.75 stroke), authored for the assistant. */
function Svg({ children, ...props }: ComponentProps<"svg">) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {children}
    </svg>
  );
}

export const SparkleIcon = (p: ComponentProps<"svg">) => (
  <Svg fill="currentColor" stroke="none" {...p}>
    <path d="M12 2.5c.5 4.9 2.6 7 7.5 7.5-4.9.5-7 2.6-7.5 7.5-.5-4.9-2.6-7-7.5-7.5 4.9-.5 7-2.6 7.5-7.5Z" />
    <path d="M19 15.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z" opacity=".8" />
  </Svg>
);
export const CloseIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const ExpandIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Svg>
);
export const CollapseIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" />
  </Svg>
);
export const PlusIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const PaperclipIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3L14.5 7" />
  </Svg>
);
export const SendIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Svg>
);
export const StopIcon = (p: ComponentProps<"svg">) => (
  <Svg fill="currentColor" stroke="none" {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </Svg>
);
export const CopyIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </Svg>
);
export const CheckIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const RefreshIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />
  </Svg>
);
export const PencilIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1ZM14 7l3 3" />
  </Svg>
);
export const ChevronIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const DocumentIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h5M9 13h6M9 17h6" />
  </Svg>
);
export const DownloadIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10.5 12 15.5l5-5M5 20h14" />
  </Svg>
);
export const ReportIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M5 20V10M12 20V4M19 20v-7" />
  </Svg>
);
export const BrainIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M12 5.5a3 3 0 0 0-5.7-1.2A3.2 3.2 0 0 0 4 7.5a3.2 3.2 0 0 0 .8 2A3.4 3.4 0 0 0 5 16a3 3 0 0 0 5 1.8A2.5 2.5 0 0 0 12 19ZM12 5.5a3 3 0 0 1 5.7-1.2A3.2 3.2 0 0 1 20 7.5a3.2 3.2 0 0 1-.8 2A3.4 3.4 0 0 1 19 16a3 3 0 0 1-5 1.8A2.5 2.5 0 0 1 12 19" />
  </Svg>
);
export const GlobeIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.4 3.7 5.2 3.7 8.5s-1.2 6.1-3.7 8.5c-2.5-2.4-3.7-5.2-3.7-8.5S9.5 5.9 12 3.5Z" />
  </Svg>
);
export const HistoryIcon = (p: ComponentProps<"svg">) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2" />
  </Svg>
);
