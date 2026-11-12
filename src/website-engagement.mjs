const metrics = [
  ['Visitors', 'الزوار', 'visitors'],
  ['Visits', 'جلسات الزيارة', 'visits'],
  ['VisitRepeats', 'الزيارات المتكررة', 'repeats'],
  ['Clicks', 'نقرات الأزرار', 'clicks'],
];

export function websiteEngagement(db, recoveredReports, project) {
  const liveCounts = db.prepare(`
    WITH visits AS (
      SELECT visitor, session FROM events
      WHERE project=? AND name='page_view' AND ts>?
    )
    SELECT COUNT(DISTINCT NULLIF(visitor,'')) AS visitors,
      COUNT(DISTINCT NULLIF(session,'')) AS visits,
      (SELECT COALESCE(SUM(extra),0) FROM (
        SELECT COUNT(DISTINCT session)-1 AS extra FROM visits
        WHERE visitor<>'' AND session<>'' GROUP BY visitor
      )) AS repeats,
      (SELECT COUNT(*) FROM events WHERE project=? AND name='click' AND ts>?) AS clicks
    FROM visits
  `);
  const totalsByCutoff = new Map();
  const countsAfter = cutoff => {
    if (!totalsByCutoff.has(cutoff)) totalsByCutoff.set(cutoff, liveCounts.get(project, cutoff, project, cutoff));
    return totalsByCutoff.get(cutoff);
  };

  const cards = metrics.map(([suffix, label, column]) => {
    const key = project + suffix;
    // Recovered reports can cover the same period. Use the newest baseline
    // for each metric and only count events collected after its capture.
    const baseline = recoveredReports.find(report => report.metrics.some(metric => metric.key === key));
    const historical = baseline?.metrics.find(metric => metric.key === key).value ?? 0;
    const cutoff = baseline ? Date.parse(baseline.capturedAt) : 0;
    return { key, label, value: historical + countsAfter(cutoff)[column] };
  });
  const clickBaseline = recoveredReports.find(report => report.metrics.some(metric => metric.key === project + 'Clicks'));
  const cutoff = clickBaseline ? Date.parse(clickBaseline.capturedAt) : 0;
  const clicks = db.prepare(`
    SELECT target,path,COUNT(*) AS count FROM events
    WHERE project=? AND name='click' AND ts>?
    GROUP BY target,path ORDER BY count DESC,target,path
  `).all(project, cutoff);
  return {
    metrics: cards,
    clicks,
    hasHistoricalVisitors: recoveredReports.some(report =>
      report.metrics.some(metric => metric.key === project + 'Visitors' && metric.value > 0)),
    unattributedClicks: clickBaseline?.metrics.find(metric => metric.key === project + 'Clicks').value ?? 0,
  };
}
