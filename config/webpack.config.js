const path = require('path');

module.exports = {
  mode: 'development',
  entry: './src/renderer/index.js',
  output: {
    path: path.resolve(__dirname, '../dist'),
    filename: 'bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-react']
          }
        }
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx']
  },
  target: 'electron-renderer',
  devtool: 'source-map'
};