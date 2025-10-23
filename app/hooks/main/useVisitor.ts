"use client";
import { useState, useEffect } from "react";

import { fetchTotalUserCount } from "@/serverActions/fetchUser";
import {
  getTodayVisitorCount,
  getTotalVisitorCount,
} from "@/serverActions/visitor";

export function useVisitor() {
  const [data, setData] = useState({
    todayCount: 0,
    totalCount: 0,
    userCount: 0,
    loading: true,
    error: null,
  });

  useEffect(() => {
    Promise.all([
      getTodayVisitorCount(),
      getTotalVisitorCount(),
      fetchTotalUserCount(),
    ])
      .then(([todayCount, totalCount, userCount]) => {
        setData({
          todayCount,
          totalCount,
          userCount,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        setData((prev) => ({ ...prev, loading: false, error }));
      });
  }, []);

  return data;
}
