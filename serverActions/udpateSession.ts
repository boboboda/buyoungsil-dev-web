// "use server"

// import prisma from "@/lib/prisma"  // Prisma 클라이언트 import
// import { getSession } from 'next-auth/react';
// import { User } from "@auth/core/types"

// async function fetchLatestUserData(email: string) {
//   console.log("여기까지 실행함")

//   if (!email) {
//     console.log("이메일이 없습니다");
//     return null;
//   }

//   try {
//     // Prisma를 사용하여 사용자 데이터 조회
//     const user = await prisma.user.findUnique({
//       where: { email },
//       select: {
//         id: true,
//         name: true,
//         email: true,
//         role: true,
//         image: true,
//         emailVerified: true
//         // password 필드는 제외
//       }
//     });

//     console.log('user', user)

//     if (!user) {
//       console.log('사용자를 찾을 수 없습니다:', email);
//       return null;
//     }

//     return user;
//   } catch (error) {
//     console.error('사용자 데이터 조회 오류:', error);
//     return null;
//   }
// }

// export async function refreshUserSession() {
//   console.log("두번째")

//   const session = await getSession()

//   if (session) {
//     try {
//       const updatedUserData = await fetchLatestUserData(session.user.email)

//       console.log("세번째", updatedUserData)

//       if (updatedUserData) {
//         try {
//           await updateSession({
//             user: {
//               ...session.user,
//               ...updatedUserData,
//             }
//           })
//         } catch (error) {
//           console.log("세션 업데이트 에러", error)
//         }
//       }

//       return updatedUserData
//     } catch (error) {
//       console.error('사용자 세션 갱신 실패:', error)
//       return null
//     }
//   }
//   return null
// }
