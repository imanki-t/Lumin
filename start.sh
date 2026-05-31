#!/bin/bash
cd frontend && npm start &
sleep 15
node --max-old-space-size=512 --expose-gc index.js
