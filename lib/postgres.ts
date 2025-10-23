// import { Pool } from 'pg';

// // 간단한 SSL 설정만 사용
// const ssl = process.env.POSTGRES_SSL === "true"
//   ? { rejectUnauthorized: false }
//   : false;

// const pool = new Pool({
//   host: process.env.POSTGRES_HOST,
//   user: process.env.POSTGRES_USER,
//   password: process.env.POSTGRES_PASSWORD,
//   database: process.env.POSTGRES_DATABASE,
//   port: parseInt(process.env.POSTGRES_PORT || '5432'),
//   ssl: ssl,  // 간단한 SSL 설정
//   max: 20,
//   idleTimeoutMillis: 30000,
//   connectionTimeoutMillis: 2000,
// });

// export default pool;
