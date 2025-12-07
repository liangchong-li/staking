const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { save } = deployments;
    const { deployer } = await getNamedAccounts();
    console.log("升级Stake合约，执行账户:", deployer);

    // 读取网络信息
    const network = await ethers.provider.getNetwork();
    const networkName = network.name === "unknown" ? "localhost" : network.name;
    console.log("当前网络:", networkName);
    console.log("网络链ID:", Number(network.chainId));

    // 定义部署信息文件路径
    // const storeDir = path.resolve(__dirname, `../deployments/${networkName}`);
    // const storePath = path.resolve(storeDir, "StakeProxy.json");

    // 检查部署信息文件是否存在
    // if (!fs.existsSync(storePath)) {
    //     console.error("未找到部署信息文件:", storePath);
    //     console.log("请先运行部署脚本: npx hardhat run deploy/00_deploy_stake.js --network", networkName);
    //     return;
    // }

    const storePath = path.resolve(__dirname, "./.cache/proxyStake.json");
    const storeData = fs.readFileSync(storePath, "utf-8");

    const { proxyAddress, implAddress, abi, deployer: originalDeployer } = JSON.parse(storeData);

    console.log("代理合约地址:", proxyAddress);
    console.log("当前实现地址:", implAddress);
    console.log("原始部署账户:", originalDeployer);

    // 检查当前账户是否有升级权限
    const Stake = await ethers.getContractFactory("Stake");
    const stake = Stake.attach(proxyAddress);

    const UPGRADE_ROLE = await stake.UPGRADE_ROLE();
    const hasUpgradeRole = await stake.hasRole(UPGRADE_ROLE, deployer);

    console.log("当前账户地址:", deployer);
    console.log("是否有UPGRADE_ROLE:", hasUpgradeRole);

    if (!hasUpgradeRole) {
        console.error("❌ 当前账户没有升级权限，请使用有UPGRADE_ROLE的账户");

        // 检查是否有ADMIN_ROLE
        const ADMIN_ROLE = await stake.ADMIN_ROLE();
        const hasAdminRole = await stake.hasRole(ADMIN_ROLE, deployer);
        console.log("是否有ADMIN_ROLE:", hasAdminRole);

        if (!hasAdminRole) {
            // 检查是否有DEFAULT_ADMIN_ROLE
            const DEFAULT_ADMIN_ROLE = await stake.DEFAULT_ADMIN_ROLE();
            const hasDefaultAdminRole = await stake.hasRole(DEFAULT_ADMIN_ROLE, deployer);
            console.log("是否有DEFAULT_ADMIN_ROLE:", hasDefaultAdminRole);

            if (!hasDefaultAdminRole) {
                console.error("❌ 当前账户没有任何管理权限，无法执行升级");
                return;
            }
        }
    }

    // 获取新版本合约工厂
    console.log("正在编译新合约...");
    const StakeV2 = await ethers.getContractFactory("StakeV2");

    // 验证存储兼容性（可选）
    try {
        console.log("验证存储布局兼容性...");
        await upgrades.validateUpgrade(proxyAddress, StakeV2, {
            kind: 'uups'
        });
        console.log("✅ 存储布局兼容性验证通过");
    } catch (validationError) {
        console.error("❌ 存储布局不兼容:", validationError.message);

        // 询问是否继续
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const answer = await new Promise(resolve => {
            readline.question('存储布局不兼容，是否强制升级？(yes/no): ', resolve);
        });
        readline.close();

        if (answer.toLowerCase() !== 'yes') {
            console.log("升级已取消");
            return;
        }
        console.warn("⚠️  强制升级，跳过存储兼容性检查");
    }

    // 升级代理合约
    console.log("正在升级代理合约...");
    try {
        const stakeProxyV2 = await upgrades.upgradeProxy(proxyAddress, StakeV2);
        await stakeProxyV2.waitForDeployment();

        const proxyAddressV2 = await stakeProxyV2.getAddress();
        const newImplAddress = await upgrades.erc1967.getImplementationAddress(proxyAddressV2);

        console.log("✅ 升级成功!");
        console.log("代理合约地址（保持不变）:", proxyAddressV2);
        console.log("新实现地址:", newImplAddress);
        console.log("旧实现地址:", implAddress);

        // 验证代理地址是否一致
        if (proxyAddressV2 !== proxyAddress) {
            console.warn("⚠️  警告: 代理地址发生了变化");
        }

        // 验证新合约版本
        try {
            const stakeV2 = StakeV2.attach(proxyAddressV2);
            const version = await stakeV2.version ? await stakeV2.version() : "未知版本";
            console.log("新合约版本:", version);
        } catch (versionError) {
            console.log("新合约没有版本函数");
        }

        // 更新部署信息文件
        const updatedData = {
            ...JSON.parse(storeData),
            implAddress: newImplAddress,
            lastUpgraded: new Date().toISOString(),
            upgradedBy: deployer,
            upgradeHistory: [
                ...(JSON.parse(storeData).upgradeHistory || []),
                {
                    timestamp: new Date().toISOString(),
                    oldImplAddress: implAddress,
                    newImplAddress: newImplAddress,
                    upgradedBy: deployer,
                    network: networkName,
                }
            ]
        };

        // 保存更新后的部署信息
        fs.writeFileSync(
            storePath,
            JSON.stringify(updatedData, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            }, 2)
        );

        console.log("部署信息已更新:", storePath);

        // 保存升级记录到单独文件
        // 获取交易哈希
        const deploymentTransaction = stakeProxyV2.deploymentTransaction();
        let txHash = null;
        if (deploymentTransaction) {
            txHash = deploymentTransaction.hash;
            console.log("交易哈希:", txHash);
        } else {
            console.warn("无法获取交易哈希，deploymentTransaction为null");
        }

        const storeDir = path.resolve(__dirname, "./.cache");
        const upgradeRecordPath = path.resolve(storeDir, `StakeProxy.upgrade-${Date.now()}.json`);
        const upgradeRecord = {
            proxyAddress: proxyAddressV2,
            oldImplAddress: implAddress,
            newImplAddress: newImplAddress,
            network: networkName,
            chainId: Number(network.chainId),
            deployer: deployer,
            upgradedAt: new Date().toISOString(),
            txHash: txHash,
        };

        fs.writeFileSync(
            upgradeRecordPath,
            JSON.stringify(upgradeRecord, (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString();
                }
                return value;
            }, 2)
        );

        console.log("升级记录已保存:", upgradeRecordPath);

        // 使用hardhat-deploy保存新版本信息
        const StakeV2ABI = StakeV2.interface.format("json");
        await save("StakeProxyV2", {
            abi: StakeV2ABI,
            address: proxyAddressV2,
            network: networkName,
            chainId: Number(network.chainId),
            deployer: deployer,
            deployedAt: new Date().toISOString(),
            implementation: newImplAddress,
            previousVersion: "StakeProxy",
        });

        console.log("✅ 升级完成! 新合约已部署并保存");
    } catch (upgradeError) {
        console.error("❌ 升级失败:", upgradeError.message);

        if (upgradeError.error?.message) {
            console.error("错误详情:", upgradeError.error.message);
        }
        if (upgradeError.reason) {
            console.error("原因:", upgradeError.reason);
        }
    }
};

module.exports.tags = ['upgradeStake'];