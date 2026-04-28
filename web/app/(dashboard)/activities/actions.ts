'use server';

import {
  listPackagesForActivity,
  listSkusForActivity,
  type PackageRow,
  type SkuRow,
} from '@/lib/data';

export async function getPackagesAndSkus(
  activityId: number,
): Promise<{ packages: PackageRow[]; skus: SkuRow[] }> {
  const [packages, skus] = await Promise.all([
    listPackagesForActivity(activityId),
    listSkusForActivity(activityId),
  ]);
  return { packages, skus };
}
