// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
    getFirestore, collection, getDocs, getDoc, setDoc, doc, Timestamp,
    deleteDoc, updateDoc, query, orderBy, limit, deleteField, FieldValue, arrayRemove, findIndex, filter
} from "firebase/firestore";
import moment from "moment";
import { getStorage } from 'firebase/storage';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_APP_ID,
    measurementId: process.env.NEXT_PUBLIC_MEASUREMENT_ID,
  };
import { UUID, randomUUID } from "crypto";


const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);



// 모든 게시글 가져오기
// 컬랙션 네임 컬렉션 아이디 수집

export async function fetchPosts(collectionName) {


    const postsRef = collection(db, `${collectionName}`)

    const descQuery = await query(postsRef, orderBy("created_at", "desc"));


    const querySnapshot = await getDocs(descQuery);

    if (querySnapshot.empty) {
        return [];
    }

    const fetchedPosts = [];



    querySnapshot.forEach((doc) => {

        const aPosts = {
            id: doc.id,
            listNumber: doc.data()["listNumber"],
            password: doc.data()["password"],
            writer: doc.data()["writer"],
            title: doc.data()["title"],
            content: doc.data()["content"],
            comments: Object.values(doc.data()["comments"]).map(comment => {
                const id = comment.id
                const content = comment.content
                const writer = comment.writer
                const password = comment.password
                const created_at = comment.created_at
                const replys = comment.reply ? Object.values(comment.reply).map(reply => {

                    return {
                        id: reply.id,
                        personId: reply.personId,
                        writer: reply.writer,
                        content: reply.content,
                        password: reply.password,
                        created_at: moment(reply.created_at.toDate).format("YYYY-MM-DD HH:mm:ss")
                    };
                }) : [];

                return {
                    id,
                    content,
                    writer,
                    password,
                    created_at,
                    replys
                }
            }),
            created_at: moment(doc.data()["created_at"].toDate()).format("YYYY-MM-DD HH:mm:ss")
        }

        console.log(aPosts.comments.reply)

        fetchedPosts.push(aPosts);

    });

    return fetchedPosts;
}



//게시글 추가하기
export async function addAPost({
    collectionName,
    password,
    title,
    writer,
    content }) {

    console.log(`파이어베이스 add 실행됨 콜랙션 ${collectionName}`)

    const postsRef = collection(db, `${collectionName}`)

    const checkQuery = await query(postsRef, orderBy("created_at", "desc"));

    const checkQuerySnapshot = await getDocs(checkQuery);

    if (checkQuerySnapshot.docs.length === 0) {

        const newPostsRef = doc(collection(db, `${collectionName}`));

        const createdAtTimestamp = Timestamp.fromDate(new Date())

        const newPostData = {
            id: newPostsRef.id,
            password: password,
            title: title,
            listNumber: 1,
            writer: writer,
            content: content,
            created_at: createdAtTimestamp.toDate(),
            comments: []
        }

        await setDoc(newPostsRef, newPostData);

        return newPostData;

    } else {

        const descQuery = await query(postsRef, orderBy("listNumber", "desc"), limit(1))

        const querySnapshot = await getDocs(descQuery, {
            cache: 'no-store'
        });

        const listNumber = await querySnapshot.docs[0].data()["listNumber"];


        console.log(`listNumber ${listNumber}`);

        const addListNumber = Number(listNumber) + 1

        console.log(`addListNumber ${addListNumber}`);

        const newPostsRef = doc(collection(db, `${collectionName}`));

        const createdAtTimestamp = Timestamp.fromDate(new Date())

        const newPostData = {
            id: newPostsRef.id,
            password: password,
            title: title,
            listNumber: addListNumber,
            writer: writer,
            content: content,
            created_at: createdAtTimestamp.toDate(),
            comments: []
        }

        await setDoc(newPostsRef, newPostData);

        return newPostData;
    }
}


//댓글 추가하기
export async function addAComment({
    collectionName,
    postId,
    commentPassword,
    commentWriter,
    commentContent }) {

    console.log(`파이어베이스 comment add 실행됨 콜랙션 ${collectionName}, postId: ${postId} ` )

    const createUuid = randomUUID();

    const createdAtTimestamp = Timestamp.fromDate(new Date())

    const postRef = doc(db, `${collectionName}`, `${postId}`);

    const postSnap = (await getDoc(postRef)).data();

    console.log(`post 조회 ${postSnap.id}`)

    if (postSnap.comments === undefined) {
        const newCommentData = {
            id: postSnap.id,
            title: postSnap.title,
            created_at: postSnap.created_at,
            listNumber: postSnap.listNumber,
            writer: postSnap.writer,
            content: postSnap.content,
            password: postSnap.password,
            comments: [
                {
                    id: createUuid,
                    password: commentPassword,
                    writer: commentWriter,
                    content: commentContent,
                    created_at: createdAtTimestamp.toDate()
                }
            ]

        }
        await setDoc(doc(db, `${collectionName}`, `${postId}`), newCommentData);

        return newCommentData;

    } else {
        const newCommentData = {
            id: postSnap.id,
            title: postSnap.title,
            created_at: postSnap.created_at,
            listNumber: postSnap.listNumber,
            writer: postSnap.writer,
            content: postSnap.content,
            password: postSnap.password,
            comments: [
                ...postSnap.comments,
                {
                    id: createUuid,
                    password: commentPassword,
                    writer: commentWriter,
                    content: commentContent,
                    created_at: createdAtTimestamp.toDate()
                }]

        }


        await setDoc(doc(db, `${collectionName}`, `${postId}`), newCommentData);

        return newCommentData;

    }


}

//댓글 삭제
export async function deleteAComment(collectionName, postId, commentId) {

    console.log(`댓글 삭제 postId${postId}, commentId ${commentId}`)

    // const fetchedPost = await fetchAPost(collectionName, id)

    const postRef = doc(db, `${collectionName}`, `${postId}`);

    const postSnap = (await getDoc(postRef)).data();

    if (postSnap.comments === undefined) {
        return null; // 댓글이 없으면 종료
    } else {

        const formatArray = Array.isArray(postSnap.comments)
            ? postSnap.comments
            : Object.values(postSnap.comments);

        const filterComments = formatArray.filter((comment) => comment.id !== commentId);

        console.log(filterComments)

        const deleteUpdateData = {
            id: postSnap.id,
            title: postSnap.title,
            created_at: postSnap.created_at,
            listNumber: postSnap.listNumber,
            writer: postSnap.writer,
            content: postSnap.content,
            password: postSnap.password,
            comments: filterComments
        }

        console.log(deleteUpdateData)

        await setDoc(postRef, deleteUpdateData);

        return deleteUpdateData;
    }
}

//답글 추가하기
export async function addAReply({
    collectionName,
    postId,
    commentId,
    personId,
    replyPassword,
    replyWriter,
    replyContent }) {

    console.log(`파이어베이스 reply add 실행됨 콜랙션 ${collectionName}`)

    console.log(`replydata: {postId: ${postId} commentId: ${commentId}, personId: ${personId}, replyPassword: ${replyPassword}, replyWriter: ${replyWriter}, replyContent: ${replyContent}}`)

    const createUuid = randomUUID();

    const createdAtTimestamp = Timestamp.fromDate(new Date())

    const postRef = doc(db, `${collectionName}`, `${postId}`);

    const postSnap = (await getDoc(postRef)).data();

    console.log(`post 조회 ${postSnap.id}`)

    const comments = Array.isArray(postSnap.comments)
            ? postSnap.comments
            : Object.values(postSnap.comments);

        const commentIndex = comments.findIndex(comment=> comment.id === commentId);

        console.log(`commentIndex 조회 ${commentIndex}`)

        if(commentIndex !== -1) {

            const selectedComment = comments[commentIndex]

            if(!selectedComment.reply) {
                selectedComment.reply = [];
            }

            selectedComment.reply.push({
                id: createUuid,
                personId: personId,
                password: replyPassword,
                writer: replyWriter,
                content: replyContent,
                created_at: createdAtTimestamp.toDate()
            })

            comments[commentIndex] = selectedComment;

            const newreplyData = {
                id: postSnap.id,
                title: postSnap.title,
                created_at: postSnap.created_at,
                listNumber: postSnap.listNumber,
                writer: postSnap.writer,
                content: postSnap.content,
                password: postSnap.password,
                comments: comments
    
            }  
            
            await setDoc(doc(db, `${collectionName}`, `${postId}`), newreplyData);

            return newreplyData;
        }
}

//답글 삭제
export async function deleteAReply(collectionName, postId, commentId, replyId) {

    console.log(`답글 삭제 postId${postId}, commentId ${commentId}, replyId ${replyId}`)

    const postRef = doc(db, `${collectionName}`, `${postId}`);

    const postSnap = (await getDoc(postRef)).data();

    if (!postSnap.comments) {
        return null; // 댓글이 없으면 종료
    } 

    const comments = Array.isArray(postSnap.comments)
            ? postSnap.comments
            : Object.values(postSnap.comments);

         // 해당 댓글 찾기
    const commentIndex = comments.findIndex(comment => comment.id === commentId);
    if (commentIndex === -1) {
        // 해당 댓글이 없으면 종료
        return null;
    }

    // 해당 댓글의 리플 배열에서 리플 삭제
    const replys = comments[commentIndex].reply || [];
    const filterReplys = replys.filter(reply => reply.id !== replyId);

    comments[commentIndex].reply = filterReplys

        const deleteUpdateData = {
            id: postSnap.id,
            title: postSnap.title,
            created_at: postSnap.created_at,
            listNumber: postSnap.listNumber,
            writer: postSnap.writer,
            content: postSnap.content,
            password: postSnap.password,
            comments: comments
        }

        console.log(deleteUpdateData)

        await setDoc(postRef, deleteUpdateData);

        return deleteUpdateData;
}

//단일 게시글 조회
export async function fetchAPost(collectionName, id) {


    if (id === null) {
        return null;
    }


    const postDocRef = doc(db, `${collectionName}`, id);

    const postDocSnap = await getDoc(postDocRef);

   

    if (postDocSnap.exists()) {

        const fetchedPost = {
            id: postDocSnap.id,
            listNumber: postDocSnap.data()["listNumber"],
            password: postDocSnap.data()["password"],
            writer: postDocSnap.data()["writer"],
            title: postDocSnap.data()["title"],
            content: postDocSnap.data()["content"],
            comments: Object.values(postDocSnap.data()["comments"]),
            created_at: postDocSnap.data()["created_at"].toDate()
        }
        return fetchedPost
    } else {

        return null;
    }


}


//단일 게시글 삭제
export async function deleteAPost(collectionName, id) {

    console.log(`post 삭제 ${id}`)

    const fetchedPost = await fetchAPost(collectionName, id)

    if (fetchedPost === null) {
        return null;
    } else {
        await deleteDoc(doc(db, `${collectionName}`, id));
        return fetchedPost;
    }
}


//단일 게시글 수정
export async function editAPost(collectionName, id, { title, password, content }) {

    console.log(`post 수정 ${collectionName} ${id} ${title}, ${password} ${content}`)

    const fetchedPost = await fetchAPost(collectionName, id)

    if (fetchedPost === null) {
        return null;
    } else {

        const postRef = doc(db, `${collectionName}`, id);

        await updateDoc(postRef, {
            title,
            password,
            content
        });

        return {
            id: id,
            created_at: fetchedPost.created_at,
            title: title,
            password: password,
            content: content
        };
    }
}


export { storage }
