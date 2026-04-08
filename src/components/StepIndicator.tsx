"use client";

import { Check } from "lucide-react";

const STEPS = [
  { label: "Enter Project" },
  { label: "Select Folders" },
  { label: "Download" },
];

export default function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6">
      {STEPS.map((step, i) => {
        const stepNum = i + 1;
        const isComplete = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;

        return (
          <div key={step.label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`
                  flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors
                  ${isComplete ? "bg-blue-600 text-white" : ""}
                  ${isCurrent ? "bg-blue-600 text-white ring-2 ring-blue-200" : ""}
                  ${!isComplete && !isCurrent ? "bg-gray-200 text-gray-500" : ""}
                `}
              >
                {isComplete ? <Check size={16} /> : stepNum}
              </div>
              <span
                className={`text-sm font-medium ${
                  isCurrent ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`w-12 h-0.5 mx-1 ${
                  isComplete ? "bg-blue-600" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
