export interface AgyWorkerReport {
  changed_files: string[];
  implementation_summary: string;
  tests_run: string[];
  test_results: {
    command: string;
    exitCode: number;
    output: string;
  }[];
  risk_notes: string[];
  review_focus: string[];
  assumptions: string[];
}

export function parseAgyReport(jsonStr: string): AgyWorkerReport | null {
  try {
    const report = JSON.parse(jsonStr);
    return {
      changed_files: Array.isArray(report.changed_files) ? report.changed_files : [],
      implementation_summary: report.implementation_summary || '',
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
