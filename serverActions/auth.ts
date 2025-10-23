// "use server"

// import { auth, signIn, signOut, update  } from '@/lib/auth/auth'

// export const signUpWithCredentials = async (formData: FormData) => {
//   try {
//     const result = await signIn('credentials', {
//       name: formData.get('name') || '',
//       email: formData.get('email') || '',
//       password: formData.get('password') || '',
//       action: 'register',
//       redirect: false
//     })

//     if (result?.error) {
//       return { success: false, error: result.error }
//     }

//     return { success: true }
//   } catch (error) {
//     return { success: false, error: 'An unexpected error occurred' }
//   }
// }

// export const signInWithCredentials = async (formData: FormData) => {
//   try {
//     const result = await signIn('credentials', {
//       email: formData.get('email') || '',
//       password: formData.get('password') || '',
//       action: 'login',
//       redirect: false
//     })

//     if (result?.error) {
//       return { success: false, error: result.error }
//     }

//     return { success: true }
//   } catch (error) {
//     return { success: false, error: 'An unexpected error occurred' }
//   }
// }

// export const signInWithGoogle = async () => {

//   await signIn('google', { redirect: true, redirectTo: "/" })

// }

// export const signInWithGitHub = async () => {

//   await signIn('github', {redirect: true, redirectTo: "/" })

// }

// export const signOutWithForm = async () => {
//   try {
//     await signOut({redirect: false})
//    return { success: true }
//   } catch (error) {
//     return { success: false }
//   }

// }

// export {
//   auth as getSession,
//   update as updateSession
// }
