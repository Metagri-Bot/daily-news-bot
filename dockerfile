# ベースイメージを指定
FROM node:20

# 作業ディレクトリを作成
WORKDIR ../../

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./


# 依存パッケージをインストール
RUN npm install

# アプリケーションファイルを全部コピー
COPY . .

# コンテナ起動時にnpm startを実行
CMD ["npm", "start"]
