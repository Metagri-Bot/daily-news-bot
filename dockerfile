# タイムゾーンデータをインストールし、コンテナのタイムゾーンをJSTに設定
# Debianベースのイメージなので apt-get を使用
ENV TZ=Asia/Tokyo
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 作業ディレクトリを/appに変更（より標準的なパス）
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存パッケージをインストール
RUN npm install

# アプリケーションファイルを全部コピー
COPY . .

# コンテナ起動時にnpm startを実行
CMD ["npm", "start"]
