# 2026-10-21公開のセキュリティ修正版。更新時は動作確認してタグを上げる。
FROM node:24.22.1

# タイムゾーンデータをインストールし、コンテナのタイムゾーンをJSTに設定
ENV TZ=Asia/Tokyo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 作業ディレクトリを設定
WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 依存パッケージをインストール
RUN npm install

# アプリケーションファイルを全部コピー
COPY . .

# コンテナ起動時にnpm startを実行
CMD ["npm", "start"]
