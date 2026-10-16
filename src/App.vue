<script setup lang="ts">
import HashGlobeView from "@/views/HashGlobeView.vue";
import "./lib/data/ShuffleCodec";
import "./lib/data/codecs/hcc";
import "./lib/data/codecs/numcodecsDelta";
</script>

<template>
  <HashGlobeView />
</template>

<style lang="scss">
@use "@/assets/base.scss";
</style>
