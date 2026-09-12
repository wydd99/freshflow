<template>
  <el-card shadow="never">
    <el-result icon="info" :title="route.meta.title + ' · 开发中'">
      <template #sub-title>
        <p>本页面按开发计划排期交付；接口与数据库以 database/schema.sql 为准。</p>
      </template>
    </el-result>
  </el-card>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()
</script>
