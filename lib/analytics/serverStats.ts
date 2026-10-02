// lib/analytics/serverStats.ts
// 환율 DB(exchangeRateDb) 현황 조회. 조회 전용 쿼리만 사용한다.
import type { Db } from "mongodb";

import clientPromise from "@/lib/mongodb";

const DB_NAME = "exchangeRateDb";
const CACHE_TTL_MS = 5 * 60 * 1000;
const SOCIAL_TYPES = ["GOOGLE", "KAKAO"];

export interface CollectionInfo {
  name: string;
  count: number;
  dataSize: number;
  storageSize: number;
  indexSize: number;
}

export interface RateStats {
  collection: string;
  count: number;
  dataSize: number;
  storageSize: number;
  indexSize: number;
  avgObjSize: number;
  firstAt: string | null;
  lastAt: string | null;
  days: number | null;
  perDayCount: number | null;
  perDayBytes: number | null;
  monthlyBytes: number | null;
}

export interface UserStats {
  collection: string;
  totalDocs: number;
  byType: { socialType: string; count: number }[];
  socialDocs: number;
  socialAccounts: number;
  perProvider: { provider: string; count: number }[];
  multiDeviceAccounts: number;
  firstCreatedAt: string | null;
  monthly: { month: string; devices: number; social: number }[];
}

export interface ServerStats {
  fetchedAt: string;
  db: { dataSize: number; storageSize: number; indexSize: number };
  collections: CollectionInfo[];
  rate: RateStats | null;
  users: UserStats | null;
}

// createAt 문자열("yyyy-MM-dd HH:mm:ss")은 한국 시간 기준으로 해석
const toKstDate = (value: string) => new Date(value.replace(" ", "T") + "+09:00");

async function storageOf(db: Db, name: string) {
  const [row] = await db
    .collection(name)
    .aggregate([{ $collStats: { storageStats: {} } }])
    .toArray();
  const s = row?.storageStats ?? {};

  return {
    count: Number(s.count ?? 0),
    size: Number(s.size ?? 0),
    storageSize: Number(s.storageSize ?? 0),
    totalIndexSize: Number(s.totalIndexSize ?? 0),
  };
}

async function loadCollections(db: Db): Promise<CollectionInfo[]> {
  const list = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = list.map((c) => c.name).filter((n) => !n.startsWith("system."));

  const infos = await Promise.all(
    names.map(async (name): Promise<CollectionInfo> => {
      try {
        const s = await storageOf(db, name);

        return {
          name,
          count: s.count,
          dataSize: s.size,
          storageSize: s.storageSize,
          indexSize: s.totalIndexSize,
        };
      } catch {
        return { name, count: 0, dataSize: 0, storageSize: 0, indexSize: 0 };
      }
    }),
  );

  return infos.sort((a, b) => b.dataSize - a.dataSize);
}

async function loadRateStats(
  db: Db,
  collections: CollectionInfo[],
): Promise<RateStats | null> {
  const info = collections.find((c) => c.name.toLowerCase() === "exchangerates");

  if (!info) return null;

  const col = db.collection(info.name);
  const filter = { createAt: { $type: "string" } };
  const projection = { createAt: 1 };

  const [first, last] = await Promise.all([
    col.find(filter, { projection }).sort({ createAt: 1 }).limit(1).next(),
    col.find(filter, { projection }).sort({ createAt: -1 }).limit(1).next(),
  ]);

  const firstAt = typeof first?.createAt === "string" ? first.createAt : null;
  const lastAt = typeof last?.createAt === "string" ? last.createAt : null;

  let days: number | null = null;

  if (firstAt && lastAt) {
    const diff =
      (toKstDate(lastAt).getTime() - toKstDate(firstAt).getTime()) / 86400000;

    if (Number.isFinite(diff)) days = Math.max(1, diff);
  }

  return {
    collection: info.name,
    count: info.count,
    dataSize: info.dataSize,
    storageSize: info.storageSize,
    indexSize: info.indexSize,
    avgObjSize: info.count > 0 ? info.dataSize / info.count : 0,
    firstAt,
    lastAt,
    days,
    perDayCount: days ? info.count / days : null,
    perDayBytes: days ? info.dataSize / days : null,
    monthlyBytes: days ? (info.dataSize / days) * 30 : null,
  };
}

async function loadUserStats(
  db: Db,
  collections: CollectionInfo[],
): Promise<UserStats | null> {
  const info = collections.find((c) => c.name.toLowerCase() === "users");

  if (!info) return null;

  const col = db.collection(info.name);
  const socialMatch = {
    socialType: { $in: SOCIAL_TYPES },
    socialId: { $type: "string", $ne: "" },
  };

  const [totalDocs, byTypeRaw, socialDocs, accountsRaw, firstUser, monthlyRaw] =
    await Promise.all([
      col.countDocuments({}),
      col
        .aggregate<{ _id: string; n: number }>([
          { $group: { _id: { $ifNull: ["$socialType", "NONE"] }, n: { $sum: 1 } } },
          { $sort: { n: -1 } },
        ])
        .toArray(),
      col.countDocuments(socialMatch),
      col
        .aggregate<{ _id: { t: string; id: string }; devices: number }>([
          { $match: socialMatch },
          {
            $group: {
              _id: { t: "$socialType", id: "$socialId" },
              devices: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      col
        .find({ createAt: { $type: "date" } }, { projection: { createAt: 1 } })
        .sort({ createAt: 1 })
        .limit(1)
        .next(),
      col
        .aggregate<{ _id: string; n: number; social: number }>([
          { $match: { createAt: { $type: "date" } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: "%Y-%m",
                  date: "$createAt",
                  timezone: "Asia/Seoul",
                },
              },
              n: { $sum: 1 },
              social: {
                $sum: { $cond: [{ $in: ["$socialType", SOCIAL_TYPES] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
    ]);

  const providerCount = new Map<string, number>();
  let multiDeviceAccounts = 0;

  for (const account of accountsRaw) {
    providerCount.set(account._id.t, (providerCount.get(account._id.t) ?? 0) + 1);
    if (account.devices > 1) multiDeviceAccounts += 1;
  }

  return {
    collection: info.name,
    totalDocs,
    byType: byTypeRaw.map((r) => ({ socialType: String(r._id), count: r.n })),
    socialDocs,
    socialAccounts: accountsRaw.length,
    perProvider: Array.from(providerCount, ([provider, count]) => ({
      provider,
      count,
    })),
    multiDeviceAccounts,
    firstCreatedAt:
      firstUser?.createAt instanceof Date ? firstUser.createAt.toISOString() : null,
    monthly: monthlyRaw.map((r) => ({
      month: r._id,
      devices: r.n,
      social: r.social,
    })),
  };
}

async function loadServerStats(): Promise<ServerStats> {
  const client = await clientPromise;
  const db = client.db(DB_NAME);

  const [dbStats, collections] = await Promise.all([
    db.command({ dbStats: 1 }),
    loadCollections(db),
  ]);
  const [rate, users] = await Promise.all([
    loadRateStats(db, collections),
    loadUserStats(db, collections),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    db: {
      dataSize: Number(dbStats.dataSize ?? 0),
      storageSize: Number(dbStats.storageSize ?? 0),
      indexSize: Number(dbStats.indexSize ?? 0),
    },
    collections,
    rate,
    users,
  };
}

// 5분 캐시. 정렬 쿼리가 컬렉션 전체를 훑기 때문에 매 요청마다 돌리지 않는다.
let cache: { at: number; data: ServerStats } | null = null;
let inflight: Promise<ServerStats> | null = null;

export async function getServerStats(force = false): Promise<ServerStats> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (inflight) return inflight;

  inflight = loadServerStats()
    .then((data) => {
      cache = { at: Date.now(), data };

      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}