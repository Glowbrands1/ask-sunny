// Copied from the Leadership Hub (src/components/assistant/artifact-context.tsx); keep in step with it. See src/features/l10/README.md.
"use client";

import { createContext, useContext } from "react";

export interface ArtifactDoc {
  title: string;
  markdown: string;
}
export interface ArtifactApi {
  open: (doc: ArtifactDoc) => void;
}

export const ArtifactContext = createContext<ArtifactApi>({ open: () => {} });
export const useArtifacts = () => useContext(ArtifactContext);
