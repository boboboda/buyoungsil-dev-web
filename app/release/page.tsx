export const dynamic = "force-dynamic";

import ReleaseItem from "@/components/release/releaseItem";
import { fetchApps } from "@/serverActions/releases";

export default async function ReleaseAppPage() {
  // const response = await fetchNotionAilCall()

  const response = await fetchApps();

  const fetchedApps = response?.apps ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-3 p-4 md:p-6">
      {/* {response.results?.map((aApp: any) => (
				<ReleaseItem key={aApp.id} data={aApp} />
			)
			)} */}

      {fetchedApps.map((app) => (
        <ReleaseItem key={app.id} app={app} />
      ))}
    </div>
  );
}
