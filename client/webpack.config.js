// Webpack config for Veena client.
// Ported from kl-rohit/react-js-sign-in reference, adapted for Veena:
//   - Devserver on port 5173 (so it doesn't clash with `catalyst serve` on 3000)
//   - PUBLIC_URL env var drives output.publicPath (set to '/app/' for Catalyst)
//   - API_BASE env var injected into bundle via DefinePlugin (default '/api')
//   - /api requests proxied to local Express on :3001 during `npm start`

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');

const PUBLIC_URL = process.env.PUBLIC_URL || '/';
const API_BASE = process.env.API_BASE || '/api';
const ANALYZE = process.env.ANALYZE === 'true';

// Supabase client config. The URL + anon key are PUBLIC (they ship in the
// browser bundle by design — Supabase security relies on RLS + the server, not
// on anon-key secrecy). Sourced from the gitignored functions/api/supabase-
// config.json (single source of truth) or env, so nothing extra is committed.
let _sb = {};
try { _sb = require('../functions/api/supabase-config.json'); } catch (_) { _sb = {}; }
const SUPABASE_URL = process.env.SUPABASE_URL || _sb.supabase_url || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || _sb.supabase_anon_key || '';

module.exports = (_env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? '[name].[contenthash].js' : '[name].js',
      publicPath: PUBLIC_URL,
      clean: true,
    },
    devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', { targets: 'defaults' }],
                ['@babel/preset-react', { runtime: 'automatic' }],
              ],
            },
          },
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader', 'postcss-loader'],
        },
        {
          test: /\.svg$/,
          use: ['@svgr/webpack', 'file-loader'],
        },
        {
          test: /\.(png|jpe?g|gif|webp|ico)$/i,
          type: 'asset/resource',
        },
      ],
    },
    resolve: {
      extensions: ['.js', '.jsx'],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/index.html',
        templateParameters: { PUBLIC_URL },
      }),
      new webpack.DefinePlugin({
        'process.env.API_BASE': JSON.stringify(API_BASE),
        'process.env.PUBLIC_URL': JSON.stringify(PUBLIC_URL),
        'process.env.SUPABASE_URL': JSON.stringify(SUPABASE_URL),
        'process.env.SUPABASE_ANON_KEY': JSON.stringify(SUPABASE_ANON_KEY),
      }),
      ...(ANALYZE ? [new BundleAnalyzerPlugin()] : []),
    ],
    devServer: {
      static: { directory: path.join(__dirname, 'dist') },
      historyApiFallback: true,
      port: 5173,
      hot: true,
      // Proxy /api during local dev to the Express server on :3001
      // (or to Catalyst once you move the backend over).
      proxy: [
        {
          context: ['/api'],
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      ],
    },
    optimization: isProd
      ? {
          minimize: true,
          minimizer: [new TerserPlugin(), new CssMinimizerPlugin()],
        }
      : {},
    stats: { children: false, modules: false },
  };
};
