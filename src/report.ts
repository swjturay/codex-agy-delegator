export interface AgentWorkerReport {
  changed_files?: string[];
  implementation_summary?: string;
  summary: string;
  tests_run?: string[];
  test_results?: {
    command: string;
    exitCode: number;
    output: string;
  }[];
  risk_notes: string[];
  review_focus: string[];
  assumptions: string[];
}

export function parseAgentReport(jsonStr: string): AgentWorkerReport | null {
  try {
    const report = JSON.parse(jsonStr);
    return {
      changed_files: Array.isArray(report.changed_files) ? report.changed_files : [],
      implementation_summary: report.implementation_summary || '',
      summary: report.summary || report.implementation_summary || '',
      tests_run: Array.isArray(report.tests_run) ? report.tests_run : [],
      test_results: Array.isArray(report.test_results) ? report.test_results : [],
      risk_notes: Array.isArray(report.risk_notes) ? report.risk_notes : [],
      review_focus: Array.isArray(report.review_focus) ? report.review_focus : [],
      assumptions: Array.isArray(report.assumptions) ? report.assumptions : [],
    };
  } catch (e) {
    return null;
  }
}

/** @deprecated Use parseAgentReport. Kept for v0.1 integrations. */
export const parseAgyReport = parseAgentReport;
