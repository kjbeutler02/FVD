"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

function parseProjectId(input: string): number | null {
  const trimmed = input.trim();
  const asInt = parseInt(trimmed, 10);
  if (!isNaN(asInt) && asInt > 0 && String(asInt) === trimmed) return asInt;

  // Try extracting from Filevine URL patterns
  const match = trimmed.match(/(?:projects?|Project\/Id)\/(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

interface Props {
  onSubmit: (projectId: number) => void;
  loading: boolean;
  error: string | null;
}

export default function ProjectInput({ onSubmit, loading, error }: Props) {
  const [input, setInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const projectId = parseProjectId(input);
    if (!projectId) {
      setValidationError("Enter a valid project ID or Filevine project URL");
      return;
    }
    setValidationError(null);
    onSubmit(projectId);
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50 mb-4">
            <Search className="text-blue-600" size={24} />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            Enter Project ID
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Enter a Filevine project ID or paste a project URL
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setValidationError(null);
              }}
              placeholder="e.g. 12345 or https://app.filevine.com/projects/12345"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              disabled={loading}
              autoFocus
            />
          </div>

          {(validationError || error) && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-sm text-red-700">{validationError || error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Loading project...
              </>
            ) : (
              "Load Project"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
