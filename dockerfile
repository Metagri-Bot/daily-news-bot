# ベースイメージを指定 (この行が最も重要です)
FROM node:20

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
