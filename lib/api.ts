export class API {
  public static uploadImage = async (_file: File) => {
    const reader = new FileReader();

    let imageUrl: string = "";

    reader.onload = () => {
      imageUrl = reader.result as string; // reader.result는 string | ArrayBuffer 타입이므로 string으로 캐스팅
    };

    reader.readAsDataURL(_file); // 파일을 base64로 읽음

    await new Promise((r) => setTimeout(r, 500));

    return imageUrl;
  };
}

export default API;
