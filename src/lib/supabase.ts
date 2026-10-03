import { createClient } from "@supabase/supabase-js";

const defaultUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://frtfzjchlaraywdmlhdb.supabase.co";
const defaultAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZydGZ6amNobGFyYXl3ZG1saGRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MTI4ODgsImV4cCI6MjEwNDI4ODg4OH0.gdD62zBhe8jSUSGXapq1tLd84S6OAXMgqJUji-_RFw4";

export const getSavedConfig = () => {
  if (typeof window !== "undefined") {
    const url = localStorage.getItem("sb_url") || defaultUrl;
    const key = localStorage.getItem("sb_key") || defaultAnonKey;
    return { url, key };
  }
  return { url: defaultUrl, key: defaultAnonKey };
};

const { url, key } = getSavedConfig();
export const supabase = createClient(url, key);

export interface SupabasePaymentRecord {
  id: number | string;
  collected_date?: string;
  patient_name?: string;
  scan_description?: string;
  collected_mode?: string;
  collected_mode2?: string;
  total_charges?: number;
  collected_today?: number;
  collected_today2?: number;
  bill_printed?: number | boolean;
  referring_doctor?: string;
  patient_phone?: string;
  is_advance_booking?: number | boolean;
}

/**
 * Native Supabase Email & Password Login (identical to Baby_Scan_Data.html)
 */
export async function loginWithSupabase(email: string, pass: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password: pass.trim(),
  });
  if (error) throw error;
  if (typeof window !== "undefined") {
    localStorage.setItem("sb_email", email.trim());
  }
  return data;
}

/**
 * Sign out current authenticated user
 */
export async function logoutSupabase() {
  await supabase.auth.signOut();
}

/**
 * Get current session user
 */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

/**
 * Fetch payments from Supabase PostgREST API
 */
export async function fetchPaymentsByDateRange(
  fromYMD: string,
  toYMD: string
): Promise<SupabasePaymentRecord[]> {
  try {
    const fromDate = new Date(fromYMD);
    const toDate = new Date(toYMD);
    const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    let query = supabase.from("payments").select("*").order("id", { ascending: false });

    if (diffDays <= 62) {
      // Build date strings list: DD-MM-YYYY and DD/MM/YYYY
      const dateList: string[] = [];
      let curr = new Date(fromDate);
      while (curr <= toDate) {
        const dd = String(curr.getDate()).padStart(2, "0");
        const mm = String(curr.getMonth() + 1).padStart(2, "0");
        const yyyy = curr.getFullYear();
        dateList.push(`${dd}-${mm}-${yyyy}`);
        dateList.push(`${dd}/${mm}/${yyyy}`);
        curr.setDate(curr.getDate() + 1);
      }
      query = query.in("collected_date", dateList);
    } else {
      query = query.limit(5000);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Supabase PostgREST Read Error:", error);
      throw error;
    }

    const records: SupabasePaymentRecord[] = [];
    if (data) {
      for (const r of data) {
        const cd = String(r.collected_date || "").replace(/\//g, "-").trim();
        if (!cd) continue;
        const parts = cd.split("-");
        if (parts.length === 3) {
          const sDate = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
          if (sDate >= fromYMD && sDate <= toYMD) {
            records.push(r);
          }
        }
      }
    }
    return records;
  } catch (err) {
    console.error("Failed to fetch payments from Supabase:", err);
    throw err;
  }
}
