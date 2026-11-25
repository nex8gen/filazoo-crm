import { HeaderSkeleton, LoadingRegion } from "@/components/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import styles from "@/components/analytics-surface.module.css";

export default function AnalyticsLoading() {
  return <LoadingRegion label="Loading analytics">
    <HeaderSkeleton />
    <div className={styles.dashboard}>
      <div className={styles.kpis}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className={styles.kpi}><Skeleton className="h-7 w-24" /></div>
        ))}
      </div>
      <div className={styles.reports}>
        <div className={styles.primary}><div className={styles.chartPlaceholder} /></div>
        {Array.from({ length: 4 }, (_, index) => <div key={index} className={styles.chartPlaceholder} />)}
      </div>
    </div>
  </LoadingRegion>;
}
